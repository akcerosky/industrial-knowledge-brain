from pathlib import Path

from backend.ingestion.pipeline import IngestionPipeline


def test_ingestion_pipeline_writes_outputs(tmp_path: Path) -> None:
    input_root = Path(__file__).resolve().parent / "fixtures" / "corpus"
    output_root = tmp_path / "outputs"

    pipeline = IngestionPipeline(output_root=output_root)
    processed = pipeline.process_tree(input_root)

    assert processed
    assert (output_root / "pids" / "unit4a_feed_system_overview.json").exists()
    assert any(
        entity.value in {"P-101A", "V-204", "2026-06-18"}
        for document in processed
        for entity in document.extraction.entities
    )
