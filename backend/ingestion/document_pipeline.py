from datetime import datetime
from uuid import uuid4

from models.schemas import DocumentRecord


class DocumentIngestionPipeline:
    """First-pass ingestion registry until loaders and OCR are wired in."""

    def register_document(self, document: DocumentRecord) -> DocumentRecord:
        if not document.document_id:
            document.document_id = f"doc-{uuid4()}"
        if not document.created_at:
            document.created_at = datetime.utcnow()
        return document

