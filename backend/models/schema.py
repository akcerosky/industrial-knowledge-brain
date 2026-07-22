from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ExtractionEntity(BaseModel):
    id: str
    type: Literal[
        "Equipment",
        "Person",
        "Date",
        "RegulatoryRef",
        "Procedure",
        "Parameter",
        "Organization",
        "Product",
        "Concept",
    ]
    value: str
    source_span: str


class ExtractionRelation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_entity: str = Field(alias="from")
    to_entity: str = Field(alias="to")
    type: Literal[
        "part_of",
        "feeds",
        "maintained_by",
        "inspected_by",
        "governed_by",
        "performed_on",
        "works_for",
        "produces",
        "invested_in",
        "targets",
        "associated_with",
    ]
    evidence: str


class ExtractionResult(BaseModel):
    entities: list[ExtractionEntity] = Field(default_factory=list)
    relations: list[ExtractionRelation] = Field(default_factory=list)


class DocumentRecord(BaseModel):
    document_id: Optional[str] = None
    title: str
    document_type: Literal["pdf", "scan", "spreadsheet", "pid", "email", "text"]
    source_path: str
    revision: Optional[str] = None
    created_at: Optional[datetime] = None


class Citation(BaseModel):
    document_id: str
    document_name: Optional[str] = None
    excerpt: str
    locator: str
    confidence: float = Field(ge=0.0, le=1.0)
    source_url: Optional[str] = None
    evidence_kind: Optional[str] = None
    relation_to_answer: Optional[str] = None


class QueryRequest(BaseModel):
    question: str
    top_k: int = Field(default=5, ge=1, le=20)
    include_graph_context: bool = True


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


class RecommendedAction(BaseModel):
    action_type: str
    title: str
    immediate_step: str
    risk_level: Literal["low", "medium", "high"]
    equipment_tag: Optional[str] = None
    rationale: str
    supporting_citations: list[str] = Field(default_factory=list)


class BusinessImpact(BaseModel):
    downtime_avoided_hours: int = 0
    compliance_risk_prevented: str
    maintenance_response_time_reduction_minutes: int = 0
    asset_criticality: Literal["low", "medium", "high"] = "medium"
    impact_basis: list[str] = Field(default_factory=list)


class ReasoningSummary(BaseModel):
    summary: str
    confidence_rationale: str
    strongest_facts: list[str] = Field(default_factory=list)
    graph_support_count: int = 0
    vector_support_count: int = 0
    fallback_used: bool = False


class WhatChangedItem(BaseModel):
    driver_type: Literal["latest_maintenance_log", "compliance_rule", "engineering_procedure", "inspection_history", "graph_context"]
    title: str
    summary: str


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    entities: list[Entity]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_coverage: float = Field(default=0.0, ge=0.0, le=1.0)
    source_diversity: int = 0
    retrieval_mode: Literal["vector", "graph", "hybrid"]
    graph_entities: list[str] = Field(default_factory=list)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list)
    business_impact: BusinessImpact
    reasoning_summary: ReasoningSummary
    what_changed: list[WhatChangedItem] = Field(default_factory=list)


class ScenarioEvaluateRequest(BaseModel):
    scenario_id: Literal["pump_start_readiness", "overdue_inspection_override"]


class ScenarioEvaluation(BaseModel):
    scenario_id: str
    title: str
    summary: str
    recommended_operator_decision: str
    query: QueryResponse


class RuntimeDependencyStatus(BaseModel):
    provider: str
    available: bool
    detail: str


class RuntimeStatusResponse(BaseModel):
    retrieval_mode: str
    gemini: RuntimeDependencyStatus
    postgres: RuntimeDependencyStatus
    neo4j: RuntimeDependencyStatus
    ingestion_queue_depth: int = 0
    fallback_modes: list[str] = Field(default_factory=list)


class ImpactSummaryResponse(BaseModel):
    uploaded_documents: int = 0
    processed_documents: int = 0
    extracted_entities: int = 0
    extracted_relations: int = 0
    indexed_chunks: int = 0
    equipment_tags_covered: list[str] = Field(default_factory=list)
    latest_upload_name: Optional[str] = None
    basis: list[str] = Field(default_factory=list)


class EvaluationCaseResult(BaseModel):
    question: str
    expected_fragments: list[str] = Field(default_factory=list)
    passed: bool
    confidence: float = Field(ge=0.0, le=1.0)
    citation_count: int = 0
    notes: list[str] = Field(default_factory=list)


class EvaluationSummaryResponse(BaseModel):
    passed: int = 0
    total: int = 0
    score: float = Field(default=0.0, ge=0.0, le=1.0)
    cases: list[EvaluationCaseResult] = Field(default_factory=list)


class DocumentPayload(BaseModel):
    document_id: str
    document_name: str
    document_type: str
    content_type: str
    locator: Optional[str] = None
    raw_text: str
    download_url: str


class GraphNode(BaseModel):
    id: str
    label: str
    kind: str


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str


class GraphResponse(BaseModel):
    root_tag: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class GraphSearchResult(BaseModel):
    label: str
    key: str
    display_name: str


class GraphSearchResponse(BaseModel):
    results: list[GraphSearchResult]


class AssetSummary(BaseModel):
    tag: str
    display_name: str
    document_count: int = 0
    inspection_count: int = 0
    procedure_count: int = 0
    regulatory_count: int = 0
    last_event_date: Optional[str] = None
    context_status: str = "context_available"
    ai_brief: str


class AssetListResponse(BaseModel):
    assets: list[AssetSummary]


class AssetTimelineItem(BaseModel):
    item_id: str
    item_type: Literal["inspection", "document", "procedure", "regulation"]
    title: str
    subtitle: Optional[str] = None
    event_date: Optional[str] = None


class AssetDetail(BaseModel):
    summary: AssetSummary
    documents: list[dict[str, object]] = Field(default_factory=list)
    inspections: list[dict[str, object]] = Field(default_factory=list)
    procedures: list[dict[str, object]] = Field(default_factory=list)
    regulations: list[dict[str, object]] = Field(default_factory=list)
    timeline: list[AssetTimelineItem] = Field(default_factory=list)


class KnowledgeDocumentSummary(BaseModel):
    document_id: str
    document_name: str
    document_type: str
    processing_status: Literal["indexed", "uploaded", "failed"]
    asset_tags: list[str] = Field(default_factory=list)
    entity_count: int = 0
    relation_count: int = 0
    source_path: str


class KnowledgeLibraryResponse(BaseModel):
    documents: list[KnowledgeDocumentSummary]


class PendingAction(BaseModel):
    action_id: str
    kind: Literal["compliance_flag", "work_order_draft"]
    equipment_tag: str
    title: str
    summary: str
    details: dict[str, object]
    draft_text: Optional[str] = None
    citations: list[str] = Field(default_factory=list)
    status: Literal["pending", "approved", "dismissed"]
    created_at: str
    updated_at: str


class PendingActionResponse(BaseModel):
    actions: list[PendingAction]


class ActionGenerateRequest(BaseModel):
    equipment_tag: str


class ActionStatusUpdate(BaseModel):
    status: Literal["approved", "dismissed"]


class IngestionStageModel(BaseModel):
    key: str
    label: str
    status: Literal["pending", "running", "completed", "failed"]
    detail: Optional[str] = None


class IngestionJobModel(BaseModel):
    job_id: str
    filename: str
    status: Literal["queued", "running", "completed", "failed"]
    stages: list[IngestionStageModel]
    error: Optional[str] = None
    result: Optional[dict[str, object]] = None
    created_at: str
    updated_at: str
