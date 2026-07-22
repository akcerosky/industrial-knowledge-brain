from pathlib import Path
import json

from backend.models.schema import QueryRequest
from backend.retrieval.index import DEFAULT_EMBEDDING_BACKEND
from backend.retrieval.router import HybridRetrievalRouter
from backend.retrieval.synthesize import REFUSAL_TEXT

FIXTURE_CORPUS = Path(__file__).resolve().parent / "fixtures" / "corpus"


def test_hybrid_router_combines_multiple_sources_for_supported_query() -> None:
    router = HybridRetrievalRouter(data_root=FIXTURE_CORPUS)
    response = router.query(
        QueryRequest(
            question="Before starting Pump 101A, what should be verified and what recent maintenance concern exists?",
            top_k=5,
            include_graph_context=True,
        )
    )

    assert response.confidence > 0.4
    names = {citation.document_name for citation in response.citations}
    assert "startup_feed_transfer.md" in names
    assert "maintenance_log.csv" in names or "inspection_report_2026-06-18.md" in names
    assert any(name and name.endswith(".svg") for name in names)
    assert any(citation.source_url for citation in response.citations if citation.document_name)


def test_hybrid_router_refuses_when_corpus_has_no_support() -> None:
    router = HybridRetrievalRouter(data_root=FIXTURE_CORPUS)
    response = router.query(
        QueryRequest(
            question="What is the warranty expiration date for Compressor C-900?",
            top_k=5,
            include_graph_context=True,
        )
    )

    assert response.answer == REFUSAL_TEXT
    assert response.confidence < 0.5


def test_embedding_backend_choice_is_explicit() -> None:
    assert DEFAULT_EMBEDDING_BACKEND == "local-hash-embedding"


def test_hybrid_router_excludes_internal_state_files_from_citations(tmp_path: Path) -> None:
    corpus_root = tmp_path / "corpus"
    corpus_root.mkdir()
    (corpus_root / "maintenance_log.csv").write_text(
        "Tag,Issue,Finding\nP-101A,Seal,Seal weep observed on drive end\n",
        encoding="utf-8",
    )
    state_root = corpus_root / "state"
    state_root.mkdir()
    (state_root / "pending_actions.json").write_text(
        json.dumps({"actions": [{"summary": "Internal action state should never be cited."}]}),
        encoding="utf-8",
    )

    router = HybridRetrievalRouter(data_root=corpus_root)
    response = router.query(
        QueryRequest(
            question="What recent maintenance concern exists for P-101A?",
            top_k=5,
            include_graph_context=False,
        )
    )

    names = {citation.document_name for citation in response.citations}
    assert "pending_actions.json" not in names
    assert "maintenance_log.csv" in names
