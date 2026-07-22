from __future__ import annotations

import hashlib
import json
import re
from typing import Iterable

from backend.llm import LLMClient, get_llm_client
from backend.models.schema import ExtractionEntity, ExtractionRelation, ExtractionResult


EQUIPMENT_PATTERN = re.compile(r"\b(?:P|V|TK|E)-\d{2,3}[A-Z]?\b")
DATE_PATTERN = re.compile(r"\b(?:20\d{2}-\d{2}-\d{2}|(?:0?[1-9]|1[0-2])/[0-3]?\d/20\d{2})\b")
REGULATORY_PATTERN = re.compile(r"\b(?:OSHA\s+29\s+CFR\s+\d+\.\d+|29\s+CFR\s+\d+\.\d+|API\s+\d+|EIS-\d+|EWP-\d+)\b")
PERSON_PATTERN = re.compile(r"\b[A-Z]\.\s?[A-Z][a-z]+\b")
PROCEDURE_PATTERN = re.compile(r"(?im)^(?:#\s+)?(.*(?:Procedure|Lockout|Tagout).*)$")
PARAMETER_PATTERN = re.compile(r"\b\d+(?:\.\d+)?\s?(?:m3/h|barg|hours?|seconds?)\b", re.IGNORECASE)


class RuleBasedExtractor:
    def extract(self, text: str) -> ExtractionResult:
        entities: list[ExtractionEntity] = []
        relations: list[ExtractionRelation] = []
        entity_ids_by_value: dict[str, str] = {}

        def add_entity(entity_type: ExtractionEntity.__annotations__["type"], value: str, source_span: str) -> str:
            normalized = value.strip()
            if normalized in entity_ids_by_value:
                return entity_ids_by_value[normalized]
            entity_id = _stable_entity_id(entity_type, normalized)
            entities.append(
                ExtractionEntity(id=entity_id, type=entity_type, value=normalized, source_span=source_span.strip())
            )
            entity_ids_by_value[normalized] = entity_id
            return entity_id

        for match in EQUIPMENT_PATTERN.finditer(text):
            add_entity("Equipment", match.group(0), match.group(0))
        for match in DATE_PATTERN.finditer(text):
            add_entity("Date", match.group(0), match.group(0))
        for match in REGULATORY_PATTERN.finditer(text):
            add_entity("RegulatoryRef", match.group(0), match.group(0))
        for match in PERSON_PATTERN.finditer(text):
            add_entity("Person", match.group(0), match.group(0))
        for match in PROCEDURE_PATTERN.finditer(text):
            add_entity("Procedure", match.group(1), match.group(0))
        for match in PARAMETER_PATTERN.finditer(text):
            add_entity("Parameter", match.group(0), match.group(0))

        equipment_ids = [entity.id for entity in entities if entity.type == "Equipment"]
        person_ids = [entity.id for entity in entities if entity.type == "Person"]
        date_ids = [entity.id for entity in entities if entity.type == "Date"]
        regulatory_ids = [entity.id for entity in entities if entity.type == "RegulatoryRef"]
        procedure_ids = [entity.id for entity in entities if entity.type == "Procedure"]

        for equipment_id in equipment_ids:
            for person_id in person_ids:
                relations.append(
                    ExtractionRelation(
                        **{
                            "from": equipment_id,
                            "to": person_id,
                            "type": "maintained_by",
                            "evidence": "Equipment and person co-occurred in the same document.",
                        }
                    )
                )
            for date_id in date_ids:
                relations.append(
                    ExtractionRelation(
                        **{
                            "from": date_id,
                            "to": equipment_id,
                            "type": "performed_on",
                            "evidence": "Date and equipment were mentioned in the same document.",
                        }
                    )
                )
            for regulatory_id in regulatory_ids:
                relations.append(
                    ExtractionRelation(
                        **{
                            "from": equipment_id,
                            "to": regulatory_id,
                            "type": "governed_by",
                            "evidence": "Equipment and regulatory reference were mentioned in the same document.",
                        }
                    )
                )
            for procedure_id in procedure_ids:
                relations.append(
                    ExtractionRelation(
                        **{
                            "from": procedure_id,
                            "to": equipment_id,
                            "type": "performed_on",
                            "evidence": "Procedure title and equipment appeared in the same document.",
                        }
                    )
                )

        return ExtractionResult(entities=entities, relations=_dedupe_relations(relations))


def _repair_truncated_json(content: str) -> dict | None:
    """Best-effort recovery when a JSON response is cut off mid-generation by
    the model's output-token limit: drop the dangling partial token, close
    every bracket that's still open, and retry parsing. Salvages the entities
    the model already produced instead of discarding the whole response."""
    stack: list[str] = []
    in_string = False
    escape = False
    last_safe_index = 0
    # Snapshot of `stack` at the last point where a bracket fully closed —
    # i.e. the last position where truncating would still leave balanced,
    # parseable JSON. Anything opened after this point (including brackets
    # still on `stack` at EOF) was never safely closed, so it must be
    # dropped rather than closed using the final stack state.
    last_safe_stack: list[str] = []

    for index, char in enumerate(content):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            stack.append("}" if char == "{" else "]")
        elif char in "}]":
            if stack:
                stack.pop()
            last_safe_index = index + 1
            last_safe_stack = list(stack)

    if not stack:
        # Nothing left open — this wasn't a truncation, just malformed JSON.
        return None

    truncated = content[:last_safe_index].rstrip().rstrip(",")
    repaired = truncated + "".join(reversed(last_safe_stack))
    try:
        return json.loads(repaired)
    except json.JSONDecodeError:
        return None


_BARE_ENUM_VALUES = (
    "Equipment",
    "Person",
    "Date",
    "RegulatoryRef",
    "Procedure",
    "Parameter",
    "Organization",
    "Product",
    "Concept",
    "part_of",
    "feeds",
    "maintained_by",
    "inspected_by",
    "governed_by",
    "performed_on",
    "works_for",
    "produces",
    "invested_in",
    "targets",
    "associated_with",
)
# The schema hint in the extraction prompt shows each enum's allowed values as
# a single quoted, pipe-separated string (e.g. "Equipment|Person|..."), which
# reads visually like a type-union annotation. The model occasionally echoes
# that pattern back literally, emitting the chosen value as a bare identifier
# (`"type": Procedure,`) instead of a quoted string — invalid JSON. Since the
# set of valid values is fixed and known, this is safe to patch mechanically
# before parsing rather than losing the whole response to one bad token.
_BARE_ENUM_PATTERN = re.compile(
    r'(:\s*)(' + "|".join(_BARE_ENUM_VALUES) + r')(\s*[,}\]])',
)


def _quote_bare_enum_values(content: str) -> str:
    return _BARE_ENUM_PATTERN.sub(r'\1"\2"\3', content)


class LLMExtractor:
    """Entity/relation extraction via the Gemini LLM (see backend/llm/client.py)."""

    def __init__(self, client: LLMClient | None = None) -> None:
        self.client = client if client is not None else get_llm_client()

    def extract(self, doc_type: str, text: str) -> ExtractionResult:
        if not self.client or not text.strip():
            return ExtractionResult()

        content = self.client.complete(
            system=(
                "You are an information extraction engine for any kind of document — "
                "industrial engineering documents, business documents, reports, and more.\n"
                "Extract entities and relationships as JSON only, no prose.\n"
                "Use the entity type that best fits each thing you find, and never force "
                "a bad fit into a type that doesn't apply:\n"
                "- Equipment: physical plant/industrial equipment (pumps, valves, tanks) — "
                "industrial documents only.\n"
                "- Organization: a company, team, institution, or other named group.\n"
                "- Product: a named product, service, or offering.\n"
                "- Person: a named individual.\n"
                "- Concept: a notable named idea, technology, strategy, or initiative that "
                "doesn't fit any other type.\n"
                "- Date, RegulatoryRef, Procedure, Parameter: as in industrial documents.\n"
                "If a document has no entities of a given type, do not invent one."
            ),
            user=f"Document type: {doc_type}\nDocument text: {text}",
            # Entity-dense documents can generate long entity/relation lists;
            # a tight cap here gets cut off mid-JSON before the model finishes,
            # which previously turned into a silent "0 entities" result.
            max_tokens=16384,
            json_mode=True,
            # Grammar-constrained structured output: the model can only pick
            # `type` values from the exact Literal enums ExtractionResult
            # expects, instead of inventing its own labels that then fail
            # Pydantic validation and get silently discarded below.
            json_schema=ExtractionResult.model_json_schema(),
        )
        try:
            return ExtractionResult.model_validate(json.loads(content))
        except (json.JSONDecodeError, ValueError):
            pass

        fixed = _quote_bare_enum_values(content)
        try:
            return ExtractionResult.model_validate(json.loads(fixed))
        except (json.JSONDecodeError, ValueError):
            repaired = _repair_truncated_json(fixed)
            if repaired is not None:
                try:
                    return ExtractionResult.model_validate(repaired)
                except ValueError:
                    pass
            # A malformed or truncated LLM response should degrade to "no LLM entities",
            # not take down the whole ingestion pipeline — the rule-based pass still runs.
            return ExtractionResult()


class HybridExtractor:
    def __init__(self, llm_extractor: LLMExtractor | None = None) -> None:
        self.rule_extractor = RuleBasedExtractor()
        self.llm_extractor = llm_extractor or LLMExtractor()

    def extract(self, doc_type: str, text: str) -> ExtractionResult:
        rules_result = self.rule_extractor.extract(text)
        llm_result = self.llm_extractor.extract(doc_type=doc_type, text=text)
        return merge_extraction_results([rules_result, llm_result])


def merge_extraction_results(results: Iterable[ExtractionResult]) -> ExtractionResult:
    entity_map: dict[str, ExtractionEntity] = {}
    relation_map: dict[tuple[str, str, str, str], ExtractionRelation] = {}

    for result in results:
        for entity in result.entities:
            entity_map[entity.id] = entity
        for relation in result.relations:
            key = (relation.from_entity, relation.to_entity, relation.type, relation.evidence)
            relation_map[key] = relation

    return ExtractionResult(
        entities=sorted(entity_map.values(), key=lambda entity: entity.id),
        relations=sorted(
            relation_map.values(),
            key=lambda relation: (relation.from_entity, relation.to_entity, relation.type, relation.evidence),
        ),
    )


def _dedupe_relations(relations: list[ExtractionRelation]) -> list[ExtractionRelation]:
    relation_map = {
        (relation.from_entity, relation.to_entity, relation.type, relation.evidence): relation
        for relation in relations
    }
    return list(relation_map.values())


def _stable_entity_id(entity_type: str, value: str) -> str:
    digest = hashlib.sha1(f"{entity_type}:{value}".encode("utf-8")).hexdigest()[:10]
    return f"{entity_type.lower()}-{digest}"
