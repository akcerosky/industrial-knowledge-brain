from fastapi import APIRouter

from ingestion.document_pipeline import DocumentIngestionPipeline
from models.schemas import DocumentRecord, QueryRequest, QueryResponse
from retrieval.router import HybridRetrievalRouter

router = APIRouter(tags=["industrial-knowledge-brain"])

ingestion_pipeline = DocumentIngestionPipeline()
retrieval_router = HybridRetrievalRouter()


@router.get("/status")
async def get_status() -> dict[str, str]:
    return {"api": "ready", "retrieval": "stubbed", "graph": "stubbed"}


@router.post("/ingest", response_model=DocumentRecord)
async def ingest_document(payload: DocumentRecord) -> DocumentRecord:
    return ingestion_pipeline.register_document(payload)


@router.post("/query", response_model=QueryResponse)
async def query_knowledge_brain(payload: QueryRequest) -> QueryResponse:
    return retrieval_router.query(payload)

