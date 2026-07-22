from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from backend.graph.neo4j_client import GraphStore
from backend.llm import LLMClient, get_llm_client

_NO_GENUINE_CONCERN = object()


class ComplianceChecker:
    """Proposes compliance flags from graph state. Never executes actions.

    Runs a small multi-step loop when an LLM is configured:
      1. GATHER  - pull equipment context from the graph (inspection events,
                    aliases, linked procedures/regulatory refs, documents).
      2. REASON  - ask the LLM to reason over that evidence (not just a date
                    diff) about whether there's a genuine compliance concern.
      3. CRITIQUE - the same structured response carries a confidence signal
                    for the proposal, so no separate self-critique round trip
                    is needed.
    With no LLM configured (e.g. during tests, which strip API keys), or if
    the LLM call/parse fails for any reason, this falls back to the original
    deterministic 30-day rule so behavior never regresses.
    """

    def __init__(
        self,
        graph_store: GraphStore,
        today: date | None = None,
        llm_client: LLMClient | None = None,
    ) -> None:
        self.graph_store = graph_store
        self.today = today or date(2026, 7, 21)
        self.client = llm_client if llm_client is not None else get_llm_client()

    def check_equipment(self, equipment_tag: str) -> list[dict[str, Any]]:
        context = self.graph_store.query_equipment_context(equipment_tag)
        equipment = context.get("equipment", [])
        if not equipment:
            return []

        inspection_events = context.get("inspection_events", [])
        regulatory_refs = context.get("regulatory_refs", [])
        procedures = context.get("procedures", [])
        documents = context.get("documents", [])

        if not inspection_events:
            return []

        latest_event = max(
            inspection_events,
            key=lambda event: event.get("event_date", ""),
        )
        latest_date = _parse_date(latest_event.get("event_date"))
        days_since = (self.today - latest_date).days if latest_date else None

        if days_since is None or days_since <= 30:
            return []

        supporting_docs = [doc.get("title", doc.get("document_id", "document")) for doc in documents[:3]]
        regs = [ref.get("code", "regulatory reference") for ref in regulatory_refs[:2]]
        procedure_names = [item.get("name", "procedure") for item in procedures[:2]]

        proposal = self._deterministic_proposal(
            equipment_tag, latest_event, days_since, regs, procedure_names, supporting_docs
        )

        if self.client:
            reasoned = self._reason_about_compliance(
                equipment_tag=equipment_tag,
                context=context,
                latest_event=latest_event,
                days_since=days_since,
                regs=regs,
                procedure_names=procedure_names,
                supporting_docs=supporting_docs,
            )
            if reasoned is _NO_GENUINE_CONCERN:
                # The LLM reasoned that the raw day-count doesn't reflect a real
                # compliance concern (e.g. no governing regulatory ref/procedure
                # applies) - an agentic call the old date-diff rule couldn't make.
                return []
            if reasoned is not None:
                proposal = reasoned

        return [proposal]

    def _deterministic_proposal(
        self,
        equipment_tag: str,
        latest_event: dict[str, Any],
        days_since: int,
        regs: list[str],
        procedure_names: list[str],
        supporting_docs: list[str],
    ) -> dict[str, Any]:
        return {
            "kind": "compliance_flag",
            "equipment_tag": equipment_tag,
            "title": f"Inspection interval may be exceeded for {equipment_tag}",
            "summary": (
                f"The latest graph-linked event for {equipment_tag} is dated {latest_event.get('event_date')}, "
                f"which is {days_since} days before July 21, 2026. Review whether the inspection interval has been exceeded."
            ),
            "details": {
                "latest_event_date": latest_event.get("event_date"),
                "days_since_latest_event": days_since,
                "related_regulatory_refs": regs,
                "related_procedures": procedure_names,
                "supporting_documents": supporting_docs,
                "reasoning_mode": "deterministic",
            },
            "citations": supporting_docs,
        }

    def _reason_about_compliance(
        self,
        equipment_tag: str,
        context: dict[str, Any],
        latest_event: dict[str, Any],
        days_since: int,
        regs: list[str],
        procedure_names: list[str],
        supporting_docs: list[str],
    ) -> Any:
        """Returns a proposal dict, `_NO_GENUINE_CONCERN`, or None (fall back to deterministic)."""
        assert self.client is not None
        evidence = {
            "equipment_tag": equipment_tag,
            "today": self.today.isoformat(),
            "equipment": context.get("equipment", []),
            "inspection_events": context.get("inspection_events", []),
            "regulatory_refs": context.get("regulatory_refs", []),
            "procedures": context.get("procedures", []),
            "documents": context.get("documents", []),
            "latest_inspection_event": latest_event,
            "days_since_latest_event": days_since,
        }
        try:
            content = self.client.complete(
                system=(
                    "You are a compliance reasoning agent for an industrial maintenance knowledge base. "
                    "You are given graph-derived evidence about one piece of equipment: its aliases, "
                    "inspection/event history, linked procedures, and linked regulatory references. "
                    "A deterministic rule already flagged that more than 30 days have passed since the "
                    "latest recorded inspection event. Your job is to reason genuinely over the evidence: "
                    "does this actually represent a compliance concern worth a human reviewing, and why "
                    "specifically (referencing the regulatory refs/procedures/documents where relevant), "
                    "not just restating the day count? You never execute anything - you only produce a "
                    "proposal for a human to approve or dismiss. Respond with JSON only, no prose."
                ),
                user=(
                    "Evidence (JSON):\n"
                    f"{json.dumps(evidence, default=str)}\n\n"
                    "Respond with a JSON object of this exact shape:\n"
                    "{\n"
                    '  "has_concern": true|false,\n'
                    '  "title": "short title for the proposed compliance flag",\n'
                    '  "summary": "1-3 sentence human-readable summary of the concern",\n'
                    '  "reasoning": "the actual multi-step reasoning: what the evidence shows and why it '
                    'does or does not matter, referencing specific regulatory refs/procedures/documents",\n'
                    '  "confidence": 0.0\n'
                    "}"
                ),
                max_tokens=900,
                json_mode=True,
            )
            data = json.loads(content)
            reasoning = data["reasoning"]
            if not isinstance(reasoning, str) or not reasoning.strip():
                raise ValueError("empty reasoning")
            has_concern = bool(data.get("has_concern", True))
            if not has_concern:
                return _NO_GENUINE_CONCERN
            confidence = data.get("confidence")
            confidence = float(confidence) if isinstance(confidence, (int, float)) else None

            return {
                "kind": "compliance_flag",
                "equipment_tag": equipment_tag,
                "title": str(data.get("title") or f"Inspection interval may be exceeded for {equipment_tag}"),
                "summary": str(data.get("summary") or reasoning),
                "details": {
                    "latest_event_date": latest_event.get("event_date"),
                    "days_since_latest_event": days_since,
                    "related_regulatory_refs": regs,
                    "related_procedures": procedure_names,
                    "supporting_documents": supporting_docs,
                    "reasoning_mode": "llm",
                    "reasoning": reasoning,
                    "agent_confidence": confidence,
                },
                "citations": supporting_docs,
            }
        except (json.JSONDecodeError, ValueError, KeyError, TypeError, AttributeError):
            # Any malformed/unexpected LLM response degrades to the deterministic
            # proposal already computed by the caller - never break the flow.
            return None
        except Exception:
            # Network/timeout/SDK errors from the LLM provider should never take
            # down compliance checking; fall back to the deterministic rule.
            return None


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None
