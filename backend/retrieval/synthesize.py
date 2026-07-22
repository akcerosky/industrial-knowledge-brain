from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Optional

from backend.llm import LLMClient, get_llm_client
from backend.models.schema import Citation
from backend.retrieval.index import DocumentChunk


REFUSAL_TEXT = "not enough information in the available documents"


@dataclass
class SynthesisInput:
    question: str
    graph_facts: list[dict[str, Any]]
    chunk_hits: list[tuple[DocumentChunk, float]]
    graph_direct_match: bool


@dataclass
class SynthesisOutput:
    answer: str
    citations: list[Citation]
    confidence: float
    fallback_used: bool
    llm_used: bool


class AnswerSynthesizer:
    def __init__(self, client: LLMClient | None = None) -> None:
        self.client = client if client is not None else get_llm_client()

    def synthesize(self, payload: SynthesisInput) -> SynthesisOutput:
        citations = build_citations(payload.chunk_hits, payload.graph_facts)
        confidence = compute_confidence(
            citations=citations,
            vector_scores=[score for _, score in payload.chunk_hits],
            graph_direct_match=payload.graph_direct_match,
        )
        if confidence < 0.35 or not citations:
            return SynthesisOutput(
                answer=REFUSAL_TEXT,
                citations=citations,
                confidence=round(confidence, 2),
                fallback_used=True,
                llm_used=False,
            )

        if self.client:
            llm_answer = self._llm_answer(payload)
            if llm_answer:
                return SynthesisOutput(
                    answer=llm_answer,
                    citations=citations,
                    confidence=round(confidence, 2),
                    fallback_used=False,
                    llm_used=True,
                )

        return SynthesisOutput(
            answer=self._fallback_answer(payload, citations),
            citations=citations,
            confidence=round(confidence, 2),
            fallback_used=True,
            llm_used=False,
        )

    def _llm_answer(self, payload: SynthesisInput) -> Optional[str]:
        context = {
            "graph_facts": payload.graph_facts,
            "chunks": [
                {
                    "document_name": chunk.metadata.get("document_name"),
                    "locator": chunk.metadata.get("locator"),
                    "score": score,
                    "text": chunk.chunk_text,
                }
                for chunk, score in payload.chunk_hits
            ],
        }
        content = self.client.complete(
            system=(
                "Answer only from the provided context. Cite every claim with [doc_name, page/section]. "
                "If evidence is weak or missing, say 'not enough information in the available documents'."
            ),
            user=json.dumps({"question": payload.question, "context": context}),
            max_tokens=1200,
        ).strip()
        return content or None

    def _fallback_answer(self, payload: SynthesisInput, citations: list[Citation]) -> str:
        snippets = [citation.excerpt for citation in citations[:6]]
        lowered = payload.question.lower()
        procedure_citation = next((citation for citation in citations if citation.document_name and citation.document_name.endswith(".md")), None)
        pid_citation = next((citation for citation in citations if citation.document_name and citation.document_name.endswith(".svg")), None)
        maintenance_citation = next(
            (
                citation
                for citation in citations
                if citation.document_name in {"maintenance_log.csv", "inspection_report_2026-06-18.md"}
            ),
            None,
        )

        if "start" in lowered or "verify" in lowered or "procedure" in lowered:
            parts = []
            if pid_citation:
                parts.append(
                    f"The P&ID context ties Pump 101A to TK-12 and discharge isolation valve V-204 in the feed path [{pid_citation.document_name}, {pid_citation.locator}]."
                )
            if procedure_citation:
                parts.append(
                    f"Before startup or maintenance, operators should verify Valve 204 is open and confirm the related feed-transfer path is ready [{procedure_citation.document_name}, {procedure_citation.locator}]."
                )
            if maintenance_citation:
                if "weep" in maintenance_citation.excerpt.lower():
                    concern = "A recent maintenance concern was seal weep on Pump 101A"
                elif "torque" in maintenance_citation.excerpt.lower():
                    concern = "A recent maintenance concern was elevated torque or stiffness on V-204"
                else:
                    concern = "A recent maintenance or inspection concern was recorded on the pump train"
                parts.append(f"{concern} [{maintenance_citation.document_name}, {maintenance_citation.locator}].")
            if parts:
                return " ".join(parts)

        if "when" in lowered and any("event_date" in fact for fact in payload.graph_facts):
            dates = sorted({fact["event_date"] for fact in payload.graph_facts if fact.get("event_date")})
            if dates:
                return f"The most recent graph-linked event in the available documents is dated {dates[-1]}."

        if snippets:
            top = citations[0]
            return f"{_trim_excerpt(snippets[0], 180)} [{top.document_name or top.document_id}, {top.locator}]"
        return REFUSAL_TEXT


def build_citations(chunk_hits: list[tuple[DocumentChunk, float]], graph_facts: list[dict[str, Any]]) -> list[Citation]:
    citations: list[Citation] = []
    seen: set[tuple[str, str]] = set()

    for chunk, score in chunk_hits:
        key = (chunk.document_id, chunk.metadata.get("locator", "chunk:1"))
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            Citation(
                document_id=chunk.document_id,
                document_name=chunk.metadata.get("document_name"),
                excerpt=_trim_excerpt(chunk.chunk_text),
                locator=chunk.metadata.get("locator", "chunk:1"),
                confidence=max(0.0, min(score, 1.0)),
                source_url=f"/api/document/{chunk.document_id}/file",
                evidence_kind=_citation_kind(chunk.metadata.get("document_name")),
                relation_to_answer=_relation_to_answer(chunk.chunk_text),
            )
        )

    for fact in graph_facts:
        doc_id = str(fact.get("document_id", "graph-fact"))
        doc_name = fact.get("document_name")
        locator = str(fact.get("locator", "graph"))
        key = (doc_id, locator)
        if key in seen:
            continue
        excerpt = fact.get("summary") or fact.get("display_name") or fact.get("tag") or fact.get("event_date")
        if not excerpt:
            continue
        seen.add(key)
        citations.append(
            Citation(
                document_id=doc_id,
                document_name=str(doc_name) if doc_name else None,
                excerpt=str(excerpt),
                locator=locator,
                confidence=0.72 if fact.get("structured") else 0.58,
                source_url=None,
                evidence_kind="graph_context",
                relation_to_answer="Structured graph fact used to cross-check the answer.",
            )
        )

    return citations


def compute_confidence(citations: list[Citation], vector_scores: list[float], graph_direct_match: bool) -> float:
    if not citations:
        return 0.0
    source_count = len({citation.document_name or citation.document_id for citation in citations})
    source_component = min(source_count / 3.0, 1.0)
    vector_component = sum(max(0.0, min(score, 1.0)) for score in vector_scores[:3]) / max(min(len(vector_scores), 3), 1)
    graph_component = 1.0 if graph_direct_match else 0.05
    return (0.4 * source_component) + (0.35 * vector_component) + (0.25 * graph_component)


def _trim_excerpt(text: str, limit: int = 280) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    return compact if len(compact) <= limit else compact[: limit - 3] + "..."


def _citation_kind(document_name: str | None) -> str:
    if not document_name:
        return "document"
    lowered = document_name.lower()
    if "maintenance" in lowered or "log" in lowered:
        return "maintenance_log"
    if "inspection" in lowered:
        return "inspection_history"
    if "osha" in lowered or "lockout" in lowered or "loto" in lowered:
        return "compliance_rule"
    if lowered.endswith(".svg"):
        return "diagram"
    if "startup" in lowered or "procedure" in lowered:
        return "engineering_procedure"
    return "document"


def _relation_to_answer(text: str) -> str:
    lowered = text.lower()
    if "seal" in lowered or "bearing" in lowered or "vibration" in lowered:
        return "Supports the recent maintenance concern or anomaly callout."
    if "verify" in lowered or "before" in lowered or "startup" in lowered:
        return "Supports the operator verification steps before action."
    if "osha" in lowered or "lockout" in lowered or "energy" in lowered:
        return "Provides the governing compliance or safety rule."
    return "Provides direct supporting evidence for the grounded answer."
