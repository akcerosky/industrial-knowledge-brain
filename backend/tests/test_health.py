from pathlib import Path

from fastapi.testclient import TestClient

from backend.api.routes import retrieval_router
from backend.main import app

FIXTURE_CORPUS = Path(__file__).resolve().parent / "fixtures" / "corpus"

# backend.main:app's retrieval_router is a module-level singleton with no
# baked-in demo corpus (backend/data starts empty). Point it at this test's
# fixture corpus instead of the app's real (empty) data root, so the
# content-dependent assertions below have something to find.
retrieval_router.data_root = FIXTURE_CORPUS
retrieval_router.output_root = FIXTURE_CORPUS / "outputs"
retrieval_router.ingestion_pipeline.output_root = retrieval_router.output_root
retrieval_router.output_root.mkdir(parents=True, exist_ok=True)

client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_status_endpoint_reports_runtime_summary() -> None:
    response = client.get("/api/status")

    assert response.status_code == 200
    body = response.json()
    assert body["api"] == "ready"
    assert body["retrieval"] == "hybrid"
    assert body["bootstrap"]["status"] in {"idle", "running", "ready", "failed"}
    assert "graph" in body and "vector" in body and "corpus" in body
    assert isinstance(body["graph"]["equipment_nodes"], int)
    assert isinstance(body["vector"]["chunks"], int)


def test_query_stub() -> None:
    response = client.post(
        "/api/query",
        json={
            "question": "Before starting Pump 101A, what should be verified and what maintenance issue was recently observed?",
            "top_k": 3,
            "include_graph_context": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["citations"]
    assert "confidence" in body
    assert any(citation["document_name"] for citation in body["citations"])
    assert any(citation["source_url"] for citation in body["citations"])


def test_document_endpoint_returns_source_payload() -> None:
    document_id = retrieval_router.document_id_for_path(FIXTURE_CORPUS / "procedures" / "startup_feed_transfer.md")
    response = client.get(f"/api/document/{document_id}", params={"locator": "chunk:1"})

    assert response.status_code == 200
    body = response.json()
    assert body["document_name"] == "startup_feed_transfer.md"
    assert body["raw_text"]


def test_graph_endpoint_returns_equipment_context() -> None:
    response = client.get("/api/graph/P-101A")

    assert response.status_code == 200
    body = response.json()
    assert body["root_tag"] == "P-101A"
    assert any(node["kind"] == "Document" for node in body["nodes"])


def test_actions_generate_and_require_manual_approval() -> None:
    generated = client.post("/api/actions/generate", json={"equipment_tag": "P-101A"})

    assert generated.status_code == 200
    body = generated.json()
    assert body["actions"]
    assert any(action["kind"] == "compliance_flag" for action in body["actions"])
    assert any(action["kind"] == "work_order_draft" for action in body["actions"])
    assert all(action["status"] in {"pending", "approved", "dismissed"} for action in body["actions"])

    pending_action = next((action for action in body["actions"] if action["status"] == "pending"), body["actions"][0])
    action_id = pending_action["action_id"]
    updated = client.post(f"/api/actions/{action_id}", json={"status": "approved"})

    assert updated.status_code == 200
    assert updated.json()["status"] == "approved"
