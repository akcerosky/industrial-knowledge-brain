from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from backend.db import get_postgres_pool
from backend.graph.incremental_update import incremental_update
from backend.graph.merge import GraphMerger, extract_canonical_tag, stable_document_id
from backend.graph.neo4j_client import GraphStore, InMemoryGraphStore, Neo4jGraphStore
from backend.ingestion.pipeline import SKIP_FILENAMES, SUPPORTED_SUFFIXES, IngestionPipeline
from backend.models.schema import Entity, QueryRequest, QueryResponse
from backend.retrieval.index import (
    ChunkIndexer,
    DEFAULT_EMBEDDING_BACKEND,
    DocumentChunk,
    EmbeddingModel,
    InMemoryVectorStore,
    PgVectorStore,
    VectorStore,
)
from backend.retrieval.synthesize import AnswerSynthesizer, REFUSAL_TEXT, SynthesisInput
import logging


logger = logging.getLogger(__name__)


def _default_graph_store() -> GraphStore:
    uri = os.getenv("NEO4J_URI")
    if not uri:
        return InMemoryGraphStore()
    try:
        from neo4j import GraphDatabase
    except ImportError:
        return InMemoryGraphStore()

    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "")
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        driver.verify_connectivity()
    except Exception:
        # Neo4j configured but unreachable — degrade to in-memory rather than
        # taking the whole API down.
        return InMemoryGraphStore()
    return Neo4jGraphStore(driver=driver)


@dataclass
class QueryPlan:
    classification: str
    run_graph: bool
    run_vector: bool


class HybridRetrievalRouter:
    def __init__(
        self,
        graph_store: GraphStore | None = None,
        vector_store: VectorStore | None = None,
        data_root: str | Path | None = None,
    ) -> None:
        configured_data_root = data_root or os.getenv("DATA_ROOT")
        self.data_root = Path(configured_data_root) if configured_data_root else Path(__file__).resolve().parents[1] / "data"
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.output_root = self.data_root / "outputs"
        self.state_root = self.data_root / "state"
        self.database_url = os.getenv("DATABASE_URL")
        self._postgres_pool = get_postgres_pool(self.database_url, max_size=4)
        self.graph_store = graph_store or _default_graph_store()
        self.vector_store = vector_store or PgVectorStore() if os.getenv("DATABASE_URL") else InMemoryVectorStore()
        self.embedding_model = EmbeddingModel()
        self.indexer = ChunkIndexer(self.embedding_model)
        self.synthesizer = AnswerSynthesizer()
        self.ingestion_pipeline = IngestionPipeline(output_root=self.output_root)
        self.graph_merger = GraphMerger(store=self.graph_store)
        self._bootstrapped = False
        self._bootstrap_started = False
        self._bootstrap_error: str | None = None
        # Route handlers offload bootstrap onto worker threads so it doesn't
        # block the event loop; without this lock, two requests arriving
        # concurrently right after a fresh start would both see
        # `_bootstrapped is False` and race to reprocess the whole data
        # tree at once.
        self._bootstrap_lock = threading.Lock()

    def query(self, request: QueryRequest) -> QueryResponse:
        self._bootstrap_if_needed()
        plan = self._classify_query(request.question)
        retrieval_started = time.perf_counter()
        graph_results = self._run_graph_path(request.question) if request.include_graph_context and plan.run_graph else {}
        vector_results = self._run_vector_path(request.question, request.top_k) if plan.run_vector else []
        retrieval_ms = round((time.perf_counter() - retrieval_started) * 1000, 1)

        graph_facts = self._graph_facts(graph_results)
        synthesis_started = time.perf_counter()
        synthesis = self.synthesizer.synthesize(
            SynthesisInput(
                question=request.question,
                graph_facts=graph_facts,
                chunk_hits=vector_results,
                graph_direct_match=bool(graph_results.get("equipment")),
            )
        )
        synthesis_ms = round((time.perf_counter() - synthesis_started) * 1000, 1)

        entities = [
            Entity(
                entity_id=item.get("entity_id", item.get("tag", "unknown")),
                canonical_name=item.get("display_name", item.get("tag", "unknown")),
                entity_type="Equipment",
                confidence=0.9,
                source_document_id=item.get("last_seen_in", "graph"),
            )
            for item in graph_results.get("equipment", [])
        ]

        answer = synthesis.answer
        if plan.classification == "unknown" and synthesis.confidence < 0.35:
            answer = REFUSAL_TEXT

        graph_entities = [entity.canonical_name for entity in entities]
        retrieval_mode = self._retrieval_mode(graph_results, vector_results)
        evidence_coverage = self._evidence_coverage(synthesis.citations, graph_results, vector_results)
        source_diversity = len({citation.document_name or citation.document_id for citation in synthesis.citations})
        recommended_actions = self._recommended_actions(
            question=request.question,
            answer=answer,
            citations=synthesis.citations,
            equipment_tag=graph_entities[0] if graph_entities else extract_canonical_tag(request.question),
            confidence=synthesis.confidence,
        )
        business_impact = self._business_impact(
            recommended_actions=recommended_actions,
            citations=synthesis.citations,
            confidence=synthesis.confidence,
        )
        reasoning_summary = self._reasoning_summary(
            answer=answer,
            synthesis=synthesis,
            graph_results=graph_results,
            vector_results=vector_results,
            retrieval_mode=retrieval_mode,
        )
        what_changed = self._what_changed(graph_results, synthesis.citations)

        logger.info(
            "query_completed question=%r retrieval_mode=%s retrieval_ms=%s synthesis_ms=%s citation_count=%s fallback_used=%s",
            request.question,
            retrieval_mode,
            retrieval_ms,
            synthesis_ms,
            len(synthesis.citations),
            synthesis.fallback_used,
        )

        return QueryResponse(
            answer=answer,
            citations=synthesis.citations,
            entities=entities,
            confidence=synthesis.confidence,
            evidence_coverage=evidence_coverage,
            source_diversity=source_diversity,
            retrieval_mode=retrieval_mode,
            graph_entities=graph_entities,
            recommended_actions=recommended_actions,
            business_impact=business_impact,
            reasoning_summary=reasoning_summary,
            what_changed=what_changed,
        )

    def _bootstrap_if_needed(self) -> None:
        if self._bootstrapped:
            return
        with self._bootstrap_lock:
            # Re-check inside the lock: whoever was already running bootstrap
            # when we blocked on acquire has finished by the time we get in.
            if self._bootstrapped:
                return
            self._bootstrap_started = True
            self._bootstrap_error = None
            try:
                if not self._bootstrap_from_staged_documents():
                    incremental_update(self.data_root, self.ingestion_pipeline, self.graph_merger)
                    self._index_existing_documents()
                self._bootstrapped = True
            except Exception as exc:
                self._bootstrap_error = str(exc)
                self._bootstrap_started = False
                raise

    def ensure_bootstrap_started(self) -> None:
        if self._bootstrapped or self._bootstrap_started:
            return
        with self._bootstrap_lock:
            if self._bootstrapped or self._bootstrap_started:
                return
            self._bootstrap_started = True
            self._bootstrap_error = None
            threading.Thread(target=self._bootstrap_in_background, daemon=True).start()

    def _bootstrap_in_background(self) -> None:
        try:
            self._bootstrap_if_needed()
        except Exception:
            return

    def bootstrap_status(self) -> str:
        if self._bootstrapped:
            return "ready"
        if self._bootstrap_started:
            return "running"
        if self._bootstrap_error:
            return "failed"
        return "idle"

    def _index_existing_documents(self) -> None:
        self.vector_store.ensure_schema()
        chunks: list[DocumentChunk] = []
        for path in sorted(self.data_root.rglob("*")):
            if not self._is_corpus_document(path):
                continue
            document_id = self.document_id_for_path(path)
            chunks.extend(self.indexer.chunk_document(path, document_id))
        self.vector_store.upsert_chunks(chunks)

    def _bootstrap_from_staged_documents(self) -> bool:
        staged_documents = self.list_staged_documents()
        if not staged_documents:
            return False
        self.vector_store.ensure_schema()
        chunks: list[DocumentChunk] = []
        for staged in staged_documents:
            self.graph_merger.merge_document(
                {
                    "document_path": staged["document_path"],
                    "document_type": staged["document_type"],
                    "extraction": staged["extraction"],
                }
            )
            document_id = self.document_id_for_path(staged["document_path"])
            chunks.extend(
                self.indexer.chunk_text_content(
                    document_id=document_id,
                    document_name=Path(staged["document_path"]).name,
                    document_path=staged["document_path"],
                    document_type=staged["document_type"],
                    text=staged["text"],
                )
            )
        self.vector_store.upsert_chunks(chunks)
        return True

    def list_staged_documents(self) -> list[dict[str, Any]]:
        if not self._postgres_pool:
            return []
        try:
            with self._postgres_pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT document_path, doc_type, payload
                        FROM extraction_staging
                        ORDER BY created_at ASC
                        """
                    )
                    rows = cursor.fetchall()
        except Exception:
            return []

        staged: list[dict[str, Any]] = []
        for document_path, doc_type, payload in rows:
            raw_payload = payload if isinstance(payload, dict) else {}
            text = raw_payload.get("text", "")
            extraction = raw_payload.get("extraction", {})
            if not isinstance(document_path, str) or not isinstance(doc_type, str):
                continue
            if not isinstance(text, str) or not isinstance(extraction, dict):
                continue
            staged.append(
                {
                    "document_path": document_path,
                    "document_type": doc_type,
                    "text": text,
                    "extraction": extraction,
                }
            )
        return staged

    def get_staged_document(self, document_id: str) -> Optional[dict[str, Any]]:
        for staged in self.list_staged_documents():
            if self.document_id_for_path(staged["document_path"]) == document_id:
                return staged
        return None

    def _classify_query(self, question: str) -> QueryPlan:
        lowered = question.lower()
        if any(keyword in lowered for keyword in ("when", "last", "date", "who inspected", "latest")):
            return QueryPlan(classification="fact", run_graph=True, run_vector=True)
        if any(keyword in lowered for keyword in ("how", "procedure", "step", "verify", "start", "safety")):
            return QueryPlan(classification="procedure", run_graph=True, run_vector=True)
        return QueryPlan(classification="unknown", run_graph=True, run_vector=True)

    def _run_graph_path(self, question: str) -> dict[str, list[dict[str, Any]]]:
        tag = extract_canonical_tag(question)
        if not tag:
            return {}
        return self.graph_store.query_equipment_context(tag)

    def _run_vector_path(self, question: str, top_k: int) -> list[tuple[DocumentChunk, float]]:
        query_embedding = self.embedding_model.embed_text(question)
        candidates = self.vector_store.search(query_embedding, top_k=max(top_k * 3, 12))
        return self._filter_vector_hits(question, candidates, top_k=max(top_k, 6))

    def _graph_facts(self, graph_results: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
        facts: list[dict[str, Any]] = []
        documents = {doc["document_id"]: doc for doc in graph_results.get("documents", []) if doc}
        for equipment in graph_results.get("equipment", []):
            facts.append(
                {
                    "document_id": equipment.get("last_seen_in", "graph"),
                    "document_name": documents.get(equipment.get("last_seen_in", ""), {}).get("title"),
                    "tag": equipment.get("tag"),
                    "display_name": equipment.get("display_name"),
                    "locator": "graph:equipment",
                    "structured": True,
                    "summary": f"Equipment node {equipment.get('tag')} includes aliases {', '.join(equipment.get('aliases', [])[:3])}.",
                }
            )
        for event in graph_results.get("inspection_events", []):
            facts.append(
                {
                    "document_id": event.get("event_id", "graph"),
                    "document_name": "InspectionEvent",
                    "event_date": event.get("event_date"),
                    "locator": "graph:event",
                    "structured": True,
                    "summary": f"{event.get('event_type', 'event')} recorded on {event.get('event_date')}.",
                }
            )
        for procedure in graph_results.get("procedures", []):
            facts.append(
                {
                    "document_id": procedure.get("entity_id", "graph"),
                    "document_name": procedure.get("name"),
                    "locator": "graph:procedure",
                    "structured": True,
                    "summary": procedure.get("name"),
                }
            )
        return facts

    def _retrieval_mode(
        self,
        graph_results: dict[str, list[dict[str, Any]]],
        vector_results: list[tuple[DocumentChunk, float]],
    ) -> str:
        has_graph = any(graph_results.get(key) for key in graph_results)
        has_vector = bool(vector_results)
        if has_graph and has_vector:
            return "hybrid"
        if has_graph:
            return "graph"
        return "vector"

    def _evidence_coverage(
        self,
        citations: list,
        graph_results: dict[str, list[dict[str, Any]]],
        vector_results: list[tuple[DocumentChunk, float]],
    ) -> float:
        if not citations:
            return 0.0
        source_diversity = len({citation.document_name or citation.document_id for citation in citations})
        graph_bonus = 1.0 if graph_results.get("equipment") else 0.0
        vector_quality = (
            sum(max(0.0, min(score, 1.0)) for _, score in vector_results[:3]) / max(min(len(vector_results), 3), 1)
            if vector_results
            else 0.0
        )
        return round(min((0.35 * min(source_diversity / 3.0, 1.0)) + (0.4 * vector_quality) + (0.25 * graph_bonus), 1.0), 2)

    def _recommended_actions(self, question: str, answer: str, citations: list, equipment_tag: str | None, confidence: float) -> list[dict[str, Any]]:
        citation_keys = [f"{citation.document_name or citation.document_id}:{citation.locator}" for citation in citations[:3]]
        lowered = f"{question} {answer}".lower()
        actions: list[dict[str, Any]] = []

        if any(term in lowered for term in ("start", "startup", "verify")):
            actions.append(
                {
                    "action_type": "pre_start_check",
                    "title": "Run the pre-start verification checklist",
                    "immediate_step": "Confirm valve line-up, zero-energy conditions where relevant, and the latest maintenance note before startup.",
                    "risk_level": "high" if confidence < 0.65 else "medium",
                    "equipment_tag": equipment_tag,
                    "rationale": "The answer depends on both procedure guidance and recent maintenance evidence, so startup should be gated on a quick operator verification.",
                    "supporting_citations": citation_keys,
                }
            )

        if any(term in lowered for term in ("inspection", "compliance", "overdue", "audit")):
            actions.append(
                {
                    "action_type": "compliance_review",
                    "title": "Review inspection and compliance status",
                    "immediate_step": "Check the latest inspection event and confirm whether the current operating window is still compliant.",
                    "risk_level": "high",
                    "equipment_tag": equipment_tag,
                    "rationale": "Inspection history and governing rules materially affect whether the equipment should remain in service.",
                    "supporting_citations": citation_keys,
                }
            )

        if any(term in lowered for term in ("maintenance", "seal", "bearing", "vibration", "work order")):
            actions.append(
                {
                    "action_type": "maintenance_follow_up",
                    "title": "Prepare a human-reviewed maintenance follow-up",
                    "immediate_step": "Draft or approve a work order with the cited anomaly details and affected equipment.",
                    "risk_level": "medium",
                    "equipment_tag": equipment_tag,
                    "rationale": "The answer references recent condition evidence that should be translated into a tracked maintenance action.",
                    "supporting_citations": citation_keys,
                }
            )

        if not actions:
            actions.append(
                {
                    "action_type": "operator_review",
                    "title": "Verify the answer against source evidence",
                    "immediate_step": "Open the top citation and confirm the source excerpt before making an operational change.",
                    "risk_level": "low" if confidence >= 0.75 else "medium",
                    "equipment_tag": equipment_tag,
                    "rationale": "The copilot found usable evidence, but the safest next step is to verify it directly in the source.",
                    "supporting_citations": citation_keys,
                }
            )
        return actions

    def _business_impact(self, recommended_actions: list[dict[str, Any]], citations: list, confidence: float) -> dict[str, Any]:
        high_risk_actions = sum(1 for action in recommended_actions if action["risk_level"] == "high")
        medium_risk_actions = sum(1 for action in recommended_actions if action["risk_level"] == "medium")
        maintenance_signals = sum(
            1 for citation in citations if citation.evidence_kind in {"maintenance_log", "inspection_history", "compliance_rule"}
        )
        downtime_hours = (high_risk_actions * 4) + (medium_risk_actions * 2) + min(maintenance_signals, 3)
        minutes_saved = 20 + (len(recommended_actions) * 15)
        prevented = "high-risk compliance lapse" if high_risk_actions else "operator delay and rework"
        criticality = "high" if high_risk_actions or confidence < 0.6 else "medium"
        return {
            "downtime_avoided_hours": downtime_hours,
            "compliance_risk_prevented": prevented,
            "maintenance_response_time_reduction_minutes": minutes_saved,
            "asset_criticality": criticality,
            "impact_basis": [
                f"{len(recommended_actions)} recommended action(s) surfaced",
                f"{maintenance_signals} high-signal maintenance/compliance source(s) contributed",
                f"confidence score {round(confidence * 100)}% used to scale urgency",
            ],
        }

    def _reasoning_summary(
        self,
        answer: str,
        synthesis,
        graph_results: dict[str, list[dict[str, Any]]],
        vector_results: list[tuple[DocumentChunk, float]],
        retrieval_mode: str,
    ) -> dict[str, Any]:
        strongest_facts = [citation.excerpt for citation in synthesis.citations[:3]]
        if synthesis.confidence >= 0.75:
            rationale = "High confidence because multiple sources agree and the retrieval signal is strong."
        elif synthesis.confidence >= 0.5:
            rationale = "Medium confidence because the answer is grounded, but corroboration is partial."
        else:
            rationale = "Low confidence because evidence is thin or weakly corroborated; operator verification is needed."
        return {
            "summary": f"The copilot used {retrieval_mode} retrieval to answer from cited evidence and graph context.",
            "confidence_rationale": rationale,
            "strongest_facts": strongest_facts,
            "graph_support_count": sum(len(value) for value in graph_results.values()),
            "vector_support_count": len(vector_results),
            "fallback_used": synthesis.fallback_used,
        }

    def _what_changed(self, graph_results: dict[str, list[dict[str, Any]]], citations: list) -> list[dict[str, Any]]:
        drivers: list[dict[str, Any]] = []
        seen: set[str] = set()
        mapping = {
            "maintenance_log": ("latest_maintenance_log", "Latest maintenance log"),
            "inspection_history": ("inspection_history", "Inspection history"),
            "compliance_rule": ("compliance_rule", "Compliance rule"),
            "engineering_procedure": ("engineering_procedure", "Engineering procedure"),
            "graph_context": ("graph_context", "Graph context"),
        }
        for citation in citations:
            key = citation.evidence_kind or "document"
            if key not in mapping or key in seen:
                continue
            seen.add(key)
            driver_type, title = mapping[key]
            drivers.append(
                {
                    "driver_type": driver_type,
                    "title": title,
                    "summary": citation.relation_to_answer or citation.excerpt,
                }
            )
        if graph_results.get("inspection_events") and "inspection_history" not in seen:
            drivers.append(
                {
                    "driver_type": "inspection_history",
                    "title": "Inspection history",
                    "summary": "Graph-linked inspection events changed the confidence and recommended follow-up.",
                }
            )
        return drivers[:4]

    def document_id_for_path(self, path: str | Path) -> str:
        return stable_document_id(str(Path(path).resolve()))

    def _is_corpus_document(self, path: Path) -> bool:
        if not path.is_file():
            return False
        if self.output_root in path.parents or self.state_root in path.parents:
            return False
        if path.name in SKIP_FILENAMES:
            return False
        # Anything the ingestion pipeline itself wouldn't process (stray
        # OS files like .DS_Store, lockfiles, etc.) must not crash the
        # whole bootstrap — load_any() raises ValueError for these.
        return path.suffix.lower() in SUPPORTED_SUFFIXES

    def _filter_vector_hits(
        self,
        question: str,
        candidates: list[tuple[DocumentChunk, float]],
        top_k: int,
    ) -> list[tuple[DocumentChunk, float]]:
        query_terms = significant_terms(question)
        canonical_tag = extract_canonical_tag(question)
        anchor_terms = entity_anchor_terms(question)
        filtered: list[tuple[DocumentChunk, float, float]] = []

        for chunk, score in candidates:
            chunk_text = chunk.chunk_text.lower()
            overlap = sum(1 for term in query_terms if term in chunk_text)
            tag_match = bool(canonical_tag and canonical_tag.lower() in chunk_text)
            anchor_match = not anchor_terms or any(anchor in chunk_text for anchor in anchor_terms)
            if score < 0.08:
                continue
            if not anchor_match:
                continue
            if overlap < 2 and not tag_match:
                continue
            adjusted = score + (0.05 * overlap) + (0.1 if tag_match else 0.0)
            filtered.append((chunk, score, adjusted))

        filtered.sort(key=lambda item: item[2], reverse=True)
        return [(chunk, score) for chunk, score, _ in filtered[:top_k]]


STOPWORDS = {
    "the",
    "and",
    "what",
    "when",
    "where",
    "which",
    "before",
    "after",
    "with",
    "from",
    "that",
    "this",
    "have",
    "been",
    "into",
    "should",
    "would",
    "about",
    "there",
    "their",
    "recent",
    "exists",
}


def significant_terms(question: str) -> list[str]:
    return [
        term
        for term in re.findall(r"[a-z0-9\-]+", question.lower())
        if len(term) > 2 and term not in STOPWORDS
    ]


def entity_anchor_terms(question: str) -> list[str]:
    anchors = []
    for term in re.findall(r"[a-z0-9\-]+", question.lower()):
        if any(character.isdigit() for character in term):
            anchors.append(term)
    return anchors
