from pathlib import Path

from backend.agents.manager import PendingActionManager
from backend.ingestion.jobs import IngestionJobManager


def test_pending_action_manager_persists_actions_between_instances(tmp_path: Path) -> None:
    storage_path = tmp_path / "pending_actions.json"

    first = PendingActionManager(storage_path)
    created = first.upsert_actions(
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
    first.update_status(created[0]["action_id"], "approved")
    first.merge_details(created[0]["action_id"], {"qms_reference": "QMS-MOCK-123"})

    second = PendingActionManager(storage_path)
    actions = second.list_actions()

    assert len(actions) == 1
    assert actions[0]["status"] == "approved"
    assert actions[0]["details"]["qms_reference"] == "QMS-MOCK-123"


def test_ingestion_job_manager_persists_jobs_between_instances(tmp_path: Path) -> None:
    storage_path = tmp_path / "ingestion_jobs.json"

    first = IngestionJobManager(storage_path)
    job = first.create_job("demo.pdf")
    first.start_stage(job.job_id, "upload")
    first.complete_stage(job.job_id, "upload", "Received demo.pdf (42 bytes)")
    first.complete_job(job.job_id, {"document_id": "doc-demo", "chunks_indexed": 3})

    second = IngestionJobManager(storage_path)
    restored = second.get_job(job.job_id)

    assert restored is not None
    assert restored.status == "completed"
    assert restored.result == {"document_id": "doc-demo", "chunks_indexed": 3}
    assert restored.stages[0].status == "completed"
    assert restored.stages[0].detail == "Received demo.pdf (42 bytes)"
