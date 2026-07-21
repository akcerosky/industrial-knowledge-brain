from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Entity(BaseModel):
    entity_id: str
    canonical_name: str
    entity_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    source_document_id: str


class Relation(BaseModel):
    source_entity_id: str
    target_entity_id: str
    relation_type: str
    confidence: float = Field(ge=0.0, le=1.0)


class DocumentRecord(BaseModel):
    document_id: str | None = None
    title: str
    document_type: Literal["pdf", "scan", "spreadsheet", "pid", "email", "text"]
    source_path: str
    revision: str | None = None
    created_at: datetime | None = None


class Citation(BaseModel):
    document_id: str
    excerpt: str
    locator: str
    confidence: float = Field(ge=0.0, le=1.0)


class QueryRequest(BaseModel):
    question: str
    top_k: int = Field(default=5, ge=1, le=20)
    include_graph_context: bool = True


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    entities: list[Entity]

