from __future__ import annotations

import json
from typing import Any, Optional

from backend.graph.neo4j_client import GraphStore
from backend.llm import LLMClient, get_llm_client


class WorkOrderDraftAgent:
    """Drafts structured work orders for human review only.

    Runs a small multi-step loop when an LLM is configured:
      1. GATHER  - pull equipment context from the graph (inspection events,
                    aliases, linked procedures, documents).
      2. REASON  - ask the LLM to reason over that evidence to propose a
                    sensible corrective scope and priority, instead of always
                    emitting the same static template.
      3. CRITIQUE - the same structured response carries a confidence signal
                    for the draft, so no separate self-critique round trip is
                    needed.
    With no LLM configured (e.g. during tests, which strip API keys), or if
    the LLM call/parse fails for any reason, this falls back to the original
    static template so behavior never regresses.
    """

    def __init__(self, graph_store: GraphStore, llm_client: LLMClient | None = None) -> None:
        self.graph_store = graph_store
        self.client = llm_client if llm_client is not None else get_llm_client()

    def draft_for_equipment(self, equipment_tag: str) -> list[dict[str, Any]]:
        context = self.graph_store.query_equipment_context(equipment_tag)
        equipment = context.get("equipment", [])
        if not equipment:
            return []

        documents = context.get("documents", [])
        inspection_events = sorted(
            context.get("inspection_events", []),
            key=lambda event: event.get("event_date", ""),
            reverse=True,
        )
        procedures = context.get("procedures", [])

        latest_event = inspection_events[0] if inspection_events else {}
        document_names = [doc.get("title", doc.get("document_id", "document")) for doc in documents[:3]]
        procedure_names = [procedure.get("name", "procedure") for procedure in procedures[:2]]

        proposal = self._deterministic_proposal(equipment_tag, latest_event, procedure_names, document_names)

        if self.client:
            reasoned = self._reason_about_work_order(
                equipment_tag=equipment_tag,
                context=context,
                latest_event=latest_event,
                procedure_names=procedure_names,
                document_names=document_names,
            )
            if reasoned is not None:
                proposal = reasoned

        return [proposal]

    def _deterministic_proposal(
        self,
        equipment_tag: str,
        latest_event: dict[str, Any],
        procedure_names: list[str],
        document_names: list[str],
    ) -> dict[str, Any]:
        return {
            "kind": "work_order_draft",
            "equipment_tag": equipment_tag,
            "title": f"Draft work order for {equipment_tag}",
            "summary": (
                f"Prepare a corrective follow-up for {equipment_tag} based on the latest inspection and maintenance history. "
                "This is a draft only and must be approved by a human before any action is taken."
            ),
            "details": {
                "work_order_type": "Corrective Maintenance",
                "equipment_tag": equipment_tag,
                "priority": "Routine",
                "recommended_scope": [
                    "Inspect seal area and flush fittings for active leakage.",
                    "Verify discharge isolation valve torque and lubrication condition.",
                    "Confirm startup readiness per governing procedure before return to service.",
                ],
                "latest_event_date": latest_event.get("event_date"),
                "related_procedures": procedure_names,
                "supporting_documents": document_names,
                "reasoning_mode": "deterministic",
            },
            "draft_text": (
                f"Equipment: {equipment_tag}\n"
                "Work Type: Corrective Maintenance\n"
                "Recommended Scope:\n"
                "1. Inspect and correct seal weep or flush fitting issues.\n"
                "2. Verify V-204 handwheel torque and lubrication.\n"
                "3. Review startup and lockout procedures before restart.\n"
                f"References: {', '.join(document_names[:3])}"
            ),
            "citations": document_names,
        }

    def _reason_about_work_order(
        self,
        equipment_tag: str,
        context: dict[str, Any],
        latest_event: dict[str, Any],
        procedure_names: list[str],
        document_names: list[str],
    ) -> Optional[dict[str, Any]]:
        assert self.client is not None
        evidence = {
            "equipment_tag": equipment_tag,
            "equipment": context.get("equipment", []),
            "inspection_events": context.get("inspection_events", []),
            "procedures": context.get("procedures", []),
            "regulatory_refs": context.get("regulatory_refs", []),
            "documents": context.get("documents", []),
            "latest_inspection_event": latest_event,
        }
        try:
            content = self.client.complete(
                system=(
                    "You are a maintenance work-order drafting agent for an industrial knowledge base. "
                    "You are given graph-derived evidence about one piece of equipment: its aliases, "
                    "inspection/event history, linked procedures, regulatory references, and documents. "
                    "Reason over this evidence to propose the most sensible corrective work order scope "
                    "and priority - grounded in what the evidence actually shows (e.g. specific findings "
                    "in the latest inspection event, governing procedures), not a generic template. "
                    "You never execute anything - you only produce a draft for a human to approve, edit, "
                    "or dismiss. Respond with JSON only, no prose."
                ),
                user=(
                    "Evidence (JSON):\n"
                    f"{json.dumps(evidence, default=str)}\n\n"
                    "Respond with a JSON object of this exact shape:\n"
                    "{\n"
                    '  "title": "short title for the work order",\n'
                    '  "summary": "1-3 sentence human-readable summary of why this work order is needed",\n'
                    '  "priority": "Routine|Elevated|Urgent",\n'
                    '  "recommended_scope": ["step 1", "step 2", "..."],\n'
                    '  "rationale": "the actual multi-step reasoning behind the chosen scope and priority, '
                    'referencing specific evidence",\n'
                    '  "confidence": 0.0\n'
                    "}"
                ),
                max_tokens=900,
                json_mode=True,
            )
            data = json.loads(content)
            rationale = data["rationale"]
            recommended_scope = data["recommended_scope"]
            if not isinstance(rationale, str) or not rationale.strip():
                raise ValueError("empty rationale")
            if not isinstance(recommended_scope, list) or not recommended_scope:
                raise ValueError("empty recommended_scope")
            recommended_scope = [str(step) for step in recommended_scope]

            priority = str(data.get("priority") or "Routine")
            confidence = data.get("confidence")
            confidence = float(confidence) if isinstance(confidence, (int, float)) else None
            title = str(data.get("title") or f"Draft work order for {equipment_tag}")
            summary = str(data.get("summary") or rationale)

            draft_text = (
                f"Equipment: {equipment_tag}\n"
                "Work Type: Corrective Maintenance\n"
                f"Priority: {priority}\n"
                "Recommended Scope:\n"
                + "\n".join(f"{index}. {step}" for index, step in enumerate(recommended_scope, start=1))
                + f"\nReferences: {', '.join(document_names[:3])}"
            )

            return {
                "kind": "work_order_draft",
                "equipment_tag": equipment_tag,
                "title": title,
                "summary": summary,
                "details": {
                    "work_order_type": "Corrective Maintenance",
                    "equipment_tag": equipment_tag,
                    "priority": priority,
                    "recommended_scope": recommended_scope,
                    "latest_event_date": latest_event.get("event_date"),
                    "related_procedures": procedure_names,
                    "supporting_documents": document_names,
                    "reasoning_mode": "llm",
                    "reasoning": rationale,
                    "agent_confidence": confidence,
                },
                "draft_text": draft_text,
                "citations": document_names,
            }
        except (json.JSONDecodeError, ValueError, KeyError, TypeError, AttributeError):
            # Any malformed/unexpected LLM response degrades to the deterministic
            # template already computed by the caller - never break the flow.
            return None
        except Exception:
            # Network/timeout/SDK errors from the LLM provider should never take
            # down work order drafting; fall back to the static template.
            return None
