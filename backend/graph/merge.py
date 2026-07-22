from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from backend.graph.neo4j_client import GraphStore
from backend.llm import LLMClient, get_llm_client
from backend.models.schema import ExtractionEntity, ExtractionRelation, ExtractionResult


RELATION_TYPE_MAP = {
    "part_of": "PART_OF",
    "feeds": "FEEDS",
    "maintained_by": "MAINTAINED_BY",
    "inspected_by": "INSPECTED_BY",
    "governed_by": "GOVERNED_BY",
    "performed_on": "PERFORMED_BY",
    "works_for": "WORKS_FOR",
    "produces": "PRODUCES",
    "invested_in": "INVESTED_IN",
    "targets": "TARGETS",
    "associated_with": "ASSOCIATED_WITH",
}

EQUIPMENT_TAG_PATTERN = re.compile(r"\b(?:P|V|TK|E)-\d{2,3}[A-Z]?\b", re.IGNORECASE)


@dataclass
class MergeDecision:
    entity_value: str
    entity_type: str
    action: str
    resolved_key: str
    reason: str
    timestamp: str


class MergeDecisionLogger:
    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else Path("backend/graph/merge_decisions.jsonl")
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, decision: MergeDecision) -> None:
        payload = {
            "entity_value": decision.entity_value,
            "entity_type": decision.entity_type,
            "action": decision.action,
            "resolved_key": decision.resolved_key,
            "reason": decision.reason,
            "timestamp": decision.timestamp,
        }
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


class EntityResolver:
    def __init__(self, store: GraphStore, client: LLMClient | None = None) -> None:
        self.store = store
        self.client = client if client is not None else get_llm_client()

    def resolve_equipment(self, entity: ExtractionEntity) -> tuple[str, dict[str, Any], str]:
        normalized_candidate = normalize_equipment_value(entity.value)
        extracted_tag = extract_canonical_tag(entity.value)
        for node in self.store.find_nodes("Equipment"):
            known_tag = node.get("tag", "")
            known_normalized = node.get("normalized_tag", normalize_equipment_value(known_tag))
            aliases = [normalize_equipment_value(alias) for alias in node.get("aliases", [])]
            if extracted_tag and extract_canonical_tag(known_tag) == extracted_tag:
                return known_tag, node, "matched canonical tag"
            if normalized_candidate and (normalized_candidate == known_normalized or normalized_candidate in aliases):
                return known_tag or extracted_tag or normalized_candidate, node, "matched normalized alias"

        fuzzy_match = self._llm_fuzzy_match(entity.value)
        if fuzzy_match:
            for node in self.store.find_nodes("Equipment"):
                if node.get("tag") == fuzzy_match:
                    return fuzzy_match, node, "matched llm fuzzy alias"

        canonical_tag = extracted_tag or normalize_equipment_value(entity.value)
        return canonical_tag, {}, "created new equipment node"

    def _llm_fuzzy_match(self, value: str) -> Optional[str]:
        if not self.client:
            return None

        existing = [node.get("tag", "") for node in self.store.find_nodes("Equipment") if node.get("tag")]
        if not existing:
            return None
        content = self.client.complete(
            system="Return JSON only. Decide whether the candidate equipment name matches one existing canonical tag.",
            user=json.dumps(
                {
                    "candidate": value,
                    "existing_tags": existing,
                    "schema": {"match": "string|null"},
                }
            ),
            max_tokens=200,
            json_mode=True,
        )
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            return None
        match = payload.get("match")
        return str(match) if match else None


class GraphMerger:
    def __init__(self, store: GraphStore, decision_logger: MergeDecisionLogger | None = None) -> None:
        self.store = store
        self.store.ensure_schema()
        self.decision_logger = decision_logger or MergeDecisionLogger()
        self.entity_resolver = EntityResolver(store)

    def merge_document(self, extracted_json: str | Path | dict[str, Any]) -> None:
        payload = _load_payload(extracted_json)
        extraction = ExtractionResult.model_validate(payload["extraction"])
        document_id = stable_document_id(payload["document_path"])
        document_key = document_id
        document_properties = {
            "document_id": document_id,
            "path": payload["document_path"],
            "title": Path(payload["document_path"]).name,
            "doc_type": payload.get("document_type", "text"),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }
        self.store.merge_node("Document", document_key, document_properties)

        merged_entities: dict[str, tuple[str, str]] = {}
        inspection_event_key = self._maybe_create_inspection_event(document_key, document_properties, extraction)

        for entity in extraction.entities:
            label, key, properties = self._node_for_entity(entity, document_key)
            self.store.merge_node(label, key, properties)
            self.store.merge_relationship(label, key, "REFERENCED_IN", "Document", document_key, {"source_span": entity.source_span})
            merged_entities[entity.id] = (label, key)

            if inspection_event_key and label == "Equipment":
                self.store.merge_relationship("InspectionEvent", inspection_event_key, "PART_OF", label, key, {"evidence": entity.source_span})
            if inspection_event_key and label == "RegulatoryRef":
                self.store.merge_relationship("InspectionEvent", inspection_event_key, "GOVERNED_BY", label, key, {"evidence": entity.source_span})

        for relation in extraction.relations:
            self._merge_relation(relation, merged_entities, inspection_event_key)

    def _node_for_entity(self, entity: ExtractionEntity, document_key: str) -> tuple[str, str, dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        if entity.type == "Equipment":
            resolved_key, existing_node, reason = self.entity_resolver.resolve_equipment(entity)
            tag = resolved_key
            aliases = sorted(set(existing_node.get("aliases", [])) | {entity.value, entity.source_span, tag})
            props = {
                "entity_id": entity.id,
                "tag": tag,
                "normalized_tag": normalize_equipment_value(tag),
                "display_name": existing_node.get("display_name", entity.value),
                "aliases": aliases,
                "source_span": entity.source_span,
                "last_seen_in": document_key,
                "updated_at": now,
            }
            action = "merged" if existing_node else "created"
            self.decision_logger.log(
                MergeDecision(
                    entity_value=entity.value,
                    entity_type=entity.type,
                    action=action,
                    resolved_key=tag,
                    reason=reason,
                    timestamp=now,
                )
            )
            return "Equipment", tag, props

        if entity.type == "Person":
            normalized_name = normalize_text(entity.value)
            return "Person", normalized_name, {
                "entity_id": entity.id,
                "name": entity.value,
                "normalized_name": normalized_name,
                "source_span": entity.source_span,
            }

        if entity.type == "Procedure":
            normalized_name = normalize_text(entity.value)
            return "Procedure", normalized_name, {
                "entity_id": entity.id,
                "name": entity.value,
                "normalized_name": normalized_name,
                "source_span": entity.source_span,
            }

        if entity.type in ("Organization", "Product", "Concept"):
            normalized_name = normalize_text(entity.value)
            return entity.type, normalized_name, {
                "entity_id": entity.id,
                "name": entity.value,
                "normalized_name": normalized_name,
                "source_span": entity.source_span,
            }

        if entity.type == "RegulatoryRef":
            normalized_code = normalize_text(entity.value)
            return "RegulatoryRef", normalized_code, {
                "entity_id": entity.id,
                "code": entity.value,
                "normalized_code": normalized_code,
                "source_span": entity.source_span,
            }

        if entity.type == "Parameter":
            return "Parameter", entity.id, {
                "entity_id": entity.id,
                "value": entity.value,
                "normalized_value": normalize_text(entity.value),
                "source_span": entity.source_span,
            }

        if entity.type == "Date":
            event_id = stable_inspection_event_id(document_key, entity.value)
            return "InspectionEvent", event_id, {
                "event_id": event_id,
                "event_date": entity.value,
                "event_type": infer_event_type(document_key),
                "evidence": entity.source_span,
            }

        raise ValueError(f"Unsupported entity type for graph merge: {entity.type}")

    def _maybe_create_inspection_event(
        self,
        document_key: str,
        document_properties: dict[str, Any],
        extraction: ExtractionResult,
    ) -> Optional[str]:
        dates = [entity.value for entity in extraction.entities if entity.type == "Date"]
        if not dates:
            return None
        event_date = sorted(dates)[0]
        event_key = stable_inspection_event_id(document_key, event_date)
        self.store.merge_node(
            "InspectionEvent",
            event_key,
            {
                "event_id": event_key,
                "event_date": event_date,
                "event_type": infer_event_type(document_properties["path"]),
                "evidence": f"Derived from {document_properties['title']}",
            },
        )
        self.store.merge_relationship("InspectionEvent", event_key, "REFERENCED_IN", "Document", document_key, {"source_span": event_date})
        return event_key

    def _merge_relation(
        self,
        relation: ExtractionRelation,
        merged_entities: dict[str, tuple[str, str]],
        inspection_event_key: Optional[str],
    ) -> None:
        from_ref = merged_entities.get(relation.from_entity)
        to_ref = merged_entities.get(relation.to_entity)
        graph_rel_type = RELATION_TYPE_MAP.get(relation.type)
        if not graph_rel_type:
            return

        if relation.type == "performed_on" and inspection_event_key and to_ref and to_ref[0] == "Equipment":
            if from_ref and from_ref[0] == "Procedure":
                self.store.merge_relationship(
                    from_ref[0],
                    from_ref[1],
                    "PART_OF",
                    to_ref[0],
                    to_ref[1],
                    {"evidence": relation.evidence},
                )
                return
            self.store.merge_relationship(
                "InspectionEvent",
                inspection_event_key,
                "REFERENCED_IN" if from_ref and from_ref[0] == "InspectionEvent" else "PART_OF",
                to_ref[0],
                to_ref[1],
                {"evidence": relation.evidence},
            )
            return

        if from_ref and to_ref:
            self.store.merge_relationship(
                from_ref[0],
                from_ref[1],
                graph_rel_type,
                to_ref[0],
                to_ref[1],
                {"evidence": relation.evidence},
            )
            return

        if inspection_event_key and to_ref and graph_rel_type in {"MAINTAINED_BY", "INSPECTED_BY", "GOVERNED_BY"}:
            self.store.merge_relationship(
                "InspectionEvent",
                inspection_event_key,
                graph_rel_type,
                to_ref[0],
                to_ref[1],
                {"evidence": relation.evidence},
            )


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def extract_canonical_tag(value: str) -> Optional[str]:
    match = EQUIPMENT_TAG_PATTERN.search(value.upper())
    if match:
        return match.group(0).replace(" ", "")

    cleaned = value.upper()
    alias_patterns = [
        (r"\b(?:FEED\s+)?PUMP\s+(\d{2,3}[A-Z]?)\b", "P-{}"),
        (r"\b(?:ISOLATION\s+)?VALVE\s+(\d{2,3}[A-Z]?)\b", "V-{}"),
        (r"\bTANK\s+(\d{1,3}[A-Z]?)\b", "TK-{}"),
        (r"\bHEAT\s+EXCHANGER\s+(\d{2,3}[A-Z]?)\b", "E-{}"),
    ]
    for pattern, template in alias_patterns:
        alias_match = re.search(pattern, cleaned)
        if alias_match:
            return template.format(alias_match.group(1))
    return None


def normalize_equipment_value(value: str) -> str:
    canonical = extract_canonical_tag(value)
    if canonical:
        return normalize_text(canonical)
    stripped = value.lower()
    for token in ("feed", "pump", "valve", "tank", "heat", "exchanger", "isolation"):
        stripped = stripped.replace(token, "")
    return normalize_text(stripped)


def stable_document_id(path: str) -> str:
    digest = hashlib.sha1(path.encode("utf-8")).hexdigest()[:12]
    return f"doc-{digest}"


def stable_inspection_event_id(document_key: str, event_date: str) -> str:
    digest = hashlib.sha1(f"{document_key}:{event_date}".encode("utf-8")).hexdigest()[:12]
    return f"event-{digest}"


def infer_event_type(path_or_key: str) -> str:
    lowered = str(path_or_key).lower()
    if "inspection" in lowered or "report" in lowered:
        return "inspection"
    if "maintenance" in lowered or "log" in lowered:
        return "maintenance"
    return "document_observation"


def _load_payload(extracted_json: str | Path | dict[str, Any]) -> dict[str, Any]:
    if isinstance(extracted_json, dict):
        return extracted_json
    path = Path(extracted_json)
    return json.loads(path.read_text(encoding="utf-8"))
