from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_query_stub() -> None:
    response = client.post(
        "/api/query",
        json={
            "question": "What is the maintenance interval for Pump P-101?",
            "top_k": 3,
            "include_graph_context": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["citations"]
    assert body["entities"][0]["canonical_name"] == "Pump P-101"

