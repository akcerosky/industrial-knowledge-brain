from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path

from backend.ingestion.extract import HybridExtractor, merge_extraction_results
from backend.ingestion.loaders import EMAIL_SUFFIXES, IMAGE_SUFFIXES, SPREADSHEET_SUFFIXES, TEXT_SUFFIXES, load_any
from backend.ingestion.vision_extract import PIDVisionExtractor
from backend.models.schema import ExtractionResult


SUPPORTED_SUFFIXES = {".pdf"} | IMAGE_SUFFIXES | SPREADSHEET_SUFFIXES | EMAIL_SUFFIXES | TEXT_SUFFIXES
SKIP_FILENAMES = {"README.md", "verify_seed_data.py"}
SKIP_DIRECTORY_NAMES = {"outputs", "state"}


@dataclass
class ProcessedDocument:
    path: Path
    doc_type: str
    text: str
    extraction: ExtractionResult


class StageWriter:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL")

    def write(self, document: ProcessedDocument) -> None:
        if not self.database_url:
            return
        try:
            import psycopg
        except ImportError:
            return

        payload = {
            "path": str(document.path),
            "doc_type": document.doc_type,
            "text": document.text,
            "extraction": document.extraction.model_dump(mode="json", by_alias=True),
        }
        with psycopg.connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    create table if not exists extraction_staging (
                        document_path text primary key,
                        doc_type text not null,
                        payload jsonb not null,
                        created_at timestamptz not null default now()
                    )
                    """
                )
                cursor.execute(
                    """
                    insert into extraction_staging (document_path, doc_type, payload)
                    values (%s, %s, %s::jsonb)
                    on conflict (document_path) do update
                    set doc_type = excluded.doc_type,
                        payload = excluded.payload,
                        created_at = now()
                    """,
                    (str(document.path), document.doc_type, json.dumps(payload)),
                )
            connection.commit()


class IngestionPipeline:
    def __init__(self, output_root: Path, stage_writer: StageWriter | None = None) -> None:
        self.output_root = output_root
        self.output_root.mkdir(parents=True, exist_ok=True)
        self.extractor = HybridExtractor()
        self.vision_extractor = PIDVisionExtractor()
        self.stage_writer = stage_writer or StageWriter()

    def process_document(self, path: Path, input_root: Path) -> ProcessedDocument:
        doc_type, text = load_any(path)
        extraction = self.extractor.extract(doc_type=doc_type, text=text)
        if doc_type == "pid":
            try:
                vision_extraction = self.vision_extractor.extract(path.read_bytes(), filename=path.name)
            except Exception:
                vision_extraction = ExtractionResult()
            extraction = merge_extraction_results([extraction, vision_extraction])
        validated = ExtractionResult.model_validate(extraction.model_dump(by_alias=True))
        document = ProcessedDocument(path=path, doc_type=doc_type, text=text, extraction=validated)
        self._write_output(document, input_root)
        self.stage_writer.write(document)
        return document

    def process_tree(self, input_root: Path) -> list[ProcessedDocument]:
        documents: list[ProcessedDocument] = []
        for path in sorted(input_root.rglob("*")):
            if not path.is_file():
                continue
            if any(parent.name in SKIP_DIRECTORY_NAMES for parent in path.parents):
                continue
            if path.name in SKIP_FILENAMES:
                continue
            if path.suffix.lower() not in SUPPORTED_SUFFIXES:
                continue
            if self.output_root in path.parents:
                continue
            try:
                documents.append(self.process_document(path, input_root))
            except Exception as exc:  # noqa: BLE001
                # One malformed document must not permanently block bootstrap for
                # every other document, or for every request that depends on it.
                print(f"Skipping {path}: failed to process ({exc})")
        return documents

    def _write_output(self, document: ProcessedDocument, input_root: Path) -> None:
        relative_path = document.path.relative_to(input_root)
        output_path = self.output_root / relative_path.with_suffix(".json")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "document_path": str(document.path),
            "document_type": document.doc_type,
            "extraction": document.extraction.model_dump(mode="json", by_alias=True),
        }
        output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run industrial document ingestion and extraction.")
    parser.add_argument("--input", required=True, help="Input file or directory to process.")
    parser.add_argument(
        "--output",
        default=None,
        help="Directory for extracted JSON outputs. Defaults to <input>/outputs for directories.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_root = Path(args.output).resolve() if args.output else _default_output_root(input_path)

    pipeline = IngestionPipeline(output_root=output_root)
    if input_path.is_file():
        pipeline.process_document(input_path, input_path.parent)
        processed_count = 1
    else:
        processed_count = len(pipeline.process_tree(input_path))
    print(f"Processed {processed_count} document(s) into {output_root}")
    return 0


def _default_output_root(input_path: Path) -> Path:
    if input_path.is_dir():
        return input_path / "outputs"
    return input_path.parent / "outputs"


if __name__ == "__main__":
    raise SystemExit(main())
