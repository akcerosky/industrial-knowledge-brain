import json
from pathlib import Path

from backend.graph.incremental_update import incremental_update
from backend.graph.merge import GraphMerger, extract_canonical_tag
from backend.graph.neo4j_client import InMemoryGraphStore
from backend.ingestion.pipeline import IngestionPipeline
from backend.retrieval.index import InMemoryVectorStore
from backend.retrieval.router import HybridRetrievalRouter


def test_extract_canonical_tag_resolves_aliases() -> None:
    assert extract_canonical_tag("Pump 101A") == "P-101A"
    assert extract_canonical_tag("Feed Pump 101A") == "P-101A"
    assert extract_canonical_tag("Isolation Valve V-204") == "V-204"
    assert extract_canonical_tag("Tank 12") == "TK-12"


def test_merge_document_resolves_equipment_aliases(tmp_path: Path) -> None:
    payload = {
        "document_path": str(tmp_path / "alias_doc.md"),
        "document_type": "text",
        "extraction": {
            "entities": [
                {"id": "eq-1", "type": "Equipment", "value": "P-101A", "source_span": "P-101A"},
                {"id": "eq-2", "type": "Equipment", "value": "Feed Pump 101A", "source_span": "Feed Pump 101A"},
                {"id": "person-1", "type": "Person", "value": "S. Khan", "source_span": "S. Khan"},
                {"id": "date-1", "type": "Date", "value": "2026-06-18", "source_span": "2026-06-18"},
            ],
            "relations": [
                {
                    "from": "eq-2",
                    "to": "person-1",
                    "type": "maintained_by",
                    "evidence": "Feed Pump 101A inspected by S. Khan.",
                }
            ],
        },
    }

    store = InMemoryGraphStore()
    merger = GraphMerger(store=store, decision_logger=None)
    merger.merge_document(payload)

    equipment_nodes = store.find_nodes("Equipment")
    assert len(equipment_nodes) == 1
    assert equipment_nodes[0]["tag"] == "P-101A"
    assert "Feed Pump 101A" in equipment_nodes[0]["aliases"]


def test_incremental_update_adds_documents_without_duplicating_equipment(tmp_path: Path) -> None:
    input_root = Path(__file__).resolve().parent / "fixtures" / "corpus"
    output_root = tmp_path / "outputs"
    log_path = tmp_path / "merge_decisions.jsonl"

    ingestion_pipeline = IngestionPipeline(output_root=output_root)
    store = InMemoryGraphStore()
    merger = GraphMerger(store=store)
    merger.decision_logger.path = log_path

    incremental_update(input_root, ingestion_pipeline, merger)
    initial_equipment_count = len(store.find_nodes("Equipment"))
    initial_document_count = len(store.find_nodes("Document"))

    new_doc = tmp_path / "new_alias_report.md"
    new_doc.write_text(
        "\n".join(
            [
                "# Quick Inspection",
                "Inspection date: 2026-07-20",
                "Inspector: R. Mehta",
                "Observed Feed Pump 101A operating normally after alignment check.",
                "Isolation Valve V-204 remained open.",
            ]
        ),
        encoding="utf-8",
    )

    incremental_update(new_doc, ingestion_pipeline, merger)

    assert len(store.find_nodes("Equipment")) == initial_equipment_count
    assert len(store.find_nodes("Document")) == initial_document_count + 1
    assert any(node["tag"] == "P-101A" for node in store.find_nodes("Equipment"))
    assert log_path.exists()
    log_lines = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert any(line["resolved_key"] == "P-101A" for line in log_lines)


def test_sample_corpus_query_returns_documents_events_and_procedures(tmp_path: Path) -> None:
    input_root = Path(__file__).resolve().parent / "fixtures" / "corpus"
    output_root = tmp_path / "outputs"

    ingestion_pipeline = IngestionPipeline(output_root=output_root)
    store = InMemoryGraphStore()
    merger = GraphMerger(store=store)

    incremental_update(input_root, ingestion_pipeline, merger)
    context = store.query_equipment_context("P-101A")

    assert context["equipment"]
    assert context["documents"]
    assert context["inspection_events"]
    assert context["procedures"]


def test_bootstrap_rehydrates_graph_and_vectors_from_staged_documents(tmp_path: Path) -> None:
    router = HybridRetrievalRouter(
        graph_store=InMemoryGraphStore(),
        vector_store=InMemoryVectorStore(),
        data_root=tmp_path / "empty-corpus",
    )
    router.list_staged_documents = lambda: [
        {
            "document_path": str(tmp_path / "uploads" / "tank77_report.md"),
            "document_type": "text",
            "text": "\n".join(
                [
                    "# Tank 77 Lockout Review",
                    "Inspection date: 2026-07-20",
                    "Tank 77 requires lockout before service.",
                    "OSHA 29 CFR 1910.147 governs the isolation procedure.",
                ]
            ),
            "extraction": {
                "entities": [
                    {"id": "eq-1", "type": "Equipment", "value": "Tank 77", "source_span": "Tank 77"},
                    {"id": "reg-1", "type": "RegulatoryRef", "value": "OSHA 29 CFR 1910.147", "source_span": "OSHA 29 CFR 1910.147"},
                    {"id": "date-1", "type": "Date", "value": "2026-07-20", "source_span": "2026-07-20"},
                ],
                "relations": [
                    {
                        "from": "eq-1",
                        "to": "reg-1",
                        "type": "governed_by",
                        "evidence": "OSHA 29 CFR 1910.147 governs the isolation procedure.",
                    }
                ],
            },
        }
    ]

    router._bootstrap_if_needed()

    context = router.graph_store.query_equipment_context("TK-77")
    assert context["equipment"]
    assert context["regulatory_refs"]
    assert router.vector_store.count_chunks() > 0
