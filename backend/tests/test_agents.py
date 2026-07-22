from pathlib import Path

from backend.agents.compliance_check import ComplianceChecker
from backend.agents.manager import PendingActionManager
from backend.agents.work_order_draft import WorkOrderDraftAgent
from backend.retrieval.router import HybridRetrievalRouter

FIXTURE_CORPUS = Path(__file__).resolve().parent / "fixtures" / "corpus"


def test_agents_propose_compliance_flag_and_work_order_from_sample_data() -> None:
    router = HybridRetrievalRouter(data_root=FIXTURE_CORPUS)
    router._bootstrap_if_needed()

    compliance_checker = ComplianceChecker(router.graph_store)
    work_order_agent = WorkOrderDraftAgent(router.graph_store)

    compliance_actions = compliance_checker.check_equipment("P-101A")
    work_order_actions = work_order_agent.draft_for_equipment("P-101A")

    assert compliance_actions
    assert compliance_actions[0]["kind"] == "compliance_flag"
    assert work_order_actions
    assert work_order_actions[0]["kind"] == "work_order_draft"


def test_pending_action_manager_requires_explicit_status_change() -> None:
    manager = PendingActionManager()
    created = manager.upsert_actions(
        [
            {
                "kind": "compliance_flag",
                "equipment_tag": "P-101A",
                "title": "Inspection interval may be exceeded for P-101A",
                "summary": "A review is required.",
                "details": {"latest_event_date": "2026-06-18"},
                "citations": ["inspection_report_2026-06-18.md"],
            }
        ]
    )

    assert created[0]["status"] == "pending"
    updated = manager.update_status(created[0]["action_id"], "approved")
    assert updated["status"] == "approved"
