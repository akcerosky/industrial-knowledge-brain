from __future__ import annotations

from pathlib import Path
from typing import Iterable

from backend.graph.merge import GraphMerger
from backend.ingestion.pipeline import IngestionPipeline


def incremental_update(input_path: str | Path, ingestion_pipeline: IngestionPipeline, graph_merger: GraphMerger) -> list[Path]:
    root = Path(input_path).resolve()
    merged_outputs: list[Path] = []

    if root.is_file():
        processed = ingestion_pipeline.process_document(root, root.parent)
        output_path = ingestion_pipeline.output_root / root.name
        merged_output = output_path.with_suffix(".json")
        graph_merger.merge_document(merged_output)
        return [merged_output]

    processed_documents = ingestion_pipeline.process_tree(root)
    for document in processed_documents:
        output_path = ingestion_pipeline.output_root / document.path.relative_to(root).with_suffix(".json")
        graph_merger.merge_document(output_path)
        merged_outputs.append(output_path)
    return merged_outputs


def incremental_update_many(paths: Iterable[str | Path], ingestion_pipeline: IngestionPipeline, graph_merger: GraphMerger) -> list[Path]:
    merged: list[Path] = []
    for path in paths:
        merged.extend(incremental_update(path, ingestion_pipeline, graph_merger))
    return merged
