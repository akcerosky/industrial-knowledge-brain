from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse

from backend.agents.compliance_check import ComplianceChecker
from backend.agents.manager import PendingActionManager
from backend.agents.work_order_draft import WorkOrderDraftAgent
from backend.graph.merge import extract_canonical_tag
from backend.graph.neo4j_client import InMemoryGraphStore, Neo4jGraphStore
from backend.ingestion.document_pipeline import DocumentIngestionPipeline
from backend.ingestion.jobs import IngestionJob, IngestionJobManager
from backend.ingestion.loaders import load_any
from backend.integrations.qms import get_qms_connector
from backend.llm.client import get_llm_client
from backend.models.schema import (
    ActionGenerateRequest,
    ActionStatusUpdate,
    AssetDetail,
    AssetListResponse,
    AssetSummary,
    AssetTimelineItem,
    DocumentPayload,
    DocumentRecord,
    EvaluationCaseResult,
    EvaluationSummaryResponse,
    GraphEdge,
    GraphNode,
    GraphResponse,
    GraphSearchResponse,
    GraphSearchResult,
    ImpactSummaryResponse,
    IngestionJobModel,
    IngestionStageModel,
    KnowledgeDocumentSummary,
    KnowledgeLibraryResponse,
    PendingAction,
    PendingActionResponse,
    QueryRequest,
    QueryResponse,
    RuntimeDependencyStatus,
    RuntimeStatusResponse,
    ScenarioEvaluateRequest,
    ScenarioEvaluation,
)
from backend.retrieval.index import chunk_text
from backend.retrieval.router import HybridRetrievalRouter
from backend.retrieval.index import InMemoryVectorStore, PgVectorStore
from backend.ingestion.pipeline import SKIP_FILENAMES, SUPPORTED_SUFFIXES

logger = logging.getLogger(__name__)

router = APIRouter(tags=["industrial-knowledge-brain"])

ingestion_pipeline = DocumentIngestionPipeline()
retrieval_router = HybridRetrievalRouter()
data_root = Path(__file__).resolve().parents[1] / "data"
uploads_root = data_root / "uploads"
state_root = data_root / "state"
uploads_root.mkdir(parents=True, exist_ok=True)
state_root.mkdir(parents=True, exist_ok=True)
action_manager = PendingActionManager(state_root / "pending_actions.json")
ingestion_job_manager = IngestionJobManager(state_root / "ingestion_jobs.json")


@router.get("/status")
async def get_status() -> dict[str, object]:
    retrieval_router.ensure_bootstrap_started()

    graph_backend = "neo4j" if isinstance(retrieval_router.graph_store, Neo4jGraphStore) else "in-memory"
    vector_backend = "pgvector" if isinstance(retrieval_router.vector_store, PgVectorStore) else "in-memory"
    documents = _count_supported_documents(retrieval_router.data_root)
    upload_metrics = _collect_upload_metrics()
    actions = action_manager.list_actions()
    jobs = ingestion_job_manager.list_jobs()

    return {
        "api": "ready",
        "retrieval": "hybrid",
        "demo_ready": bool(documents),
        "bootstrap": {
            "status": retrieval_router.bootstrap_status(),
            "error": retrieval_router._bootstrap_error,
        },
        "graph": {
            "backend": graph_backend,
            "equipment_nodes": len(retrieval_router.graph_store.find_nodes("Equipment")),
            "document_nodes": len(retrieval_router.graph_store.find_nodes("Document")),
            "relationships": retrieval_router.graph_store.relationship_count(),
        },
        "vector": {
            "backend": vector_backend,
            "chunks": retrieval_router.vector_store.count_chunks(),
        },
        "llm": {
            "provider": "gemini" if get_llm_client() else "deterministic-fallback",
            "enabled": bool(get_llm_client()),
            "embedding_backend": retrieval_router.embedding_model.backend_name,
        },
        "corpus": {
            "documents": documents,
            "uploads": int(upload_metrics["uploaded_documents"]),
            "processed_uploads": int(upload_metrics["processed_documents"]),
            "latest_upload_name": upload_metrics["latest_upload_name"],
        },
        "actions": {
            "total": len(actions),
            "pending": sum(1 for action in actions if action["status"] == "pending"),
            "approved": sum(1 for action in actions if action["status"] == "approved"),
        },
        "jobs": {
            "total": len(jobs),
            "running": sum(1 for job in jobs if job.status == "running"),
            "completed": sum(1 for job in jobs if job.status == "completed"),
            "failed": sum(1 for job in jobs if job.status == "failed"),
        },
    }


@router.post("/ingest", response_model=DocumentRecord)
async def ingest_document(payload: DocumentRecord) -> DocumentRecord:
    return ingestion_pipeline.register_document(payload)


@router.post("/ingest/upload", response_model=IngestionJobModel)
async def upload_document(response: Response, file: UploadFile = File(...)) -> IngestionJobModel:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename")

    contents = await file.read()
    destination = _unique_upload_path(file.filename)
    destination.write_bytes(contents)

    job = ingestion_job_manager.create_job(file.filename)
    _disable_cache(response)
    asyncio.create_task(_run_ingestion_job(job.job_id, destination))
    return _job_to_model(job)


@router.get("/ingest/upload/{job_id}", response_model=IngestionJobModel)
async def get_ingestion_job(job_id: str, response: Response) -> IngestionJobModel:
    job = ingestion_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    _disable_cache(response)
    return _job_to_model(job)


@router.post("/query", response_model=QueryResponse)
async def query_knowledge_brain(payload: QueryRequest) -> QueryResponse:
    # retrieval_router.query() does synchronous LLM/DB/bootstrap work; running
    # it directly here would block the whole event loop (every other request,
    # including trivial ones) for as long as it takes.
    return await asyncio.to_thread(retrieval_router.query, payload)


@router.get("/status/runtime", response_model=RuntimeStatusResponse)
async def get_runtime_status() -> RuntimeStatusResponse:
    retrieval_router.ensure_bootstrap_started()
    jobs = ingestion_job_manager.list_jobs()
    fallback_modes: list[str] = []
    if isinstance(retrieval_router.graph_store, InMemoryGraphStore):
        fallback_modes.append("graph_in_memory")
    if isinstance(retrieval_router.vector_store, InMemoryVectorStore):
        fallback_modes.append("vector_in_memory")
    if retrieval_router.embedding_model.last_fallback_reason:
        fallback_modes.append(f"embedding_{retrieval_router.embedding_model.last_fallback_reason}")

    return RuntimeStatusResponse(
        retrieval_mode="hybrid",
        gemini=RuntimeDependencyStatus(
            provider="gemini" if get_llm_client() else "deterministic-fallback",
            available=bool(get_llm_client()),
            detail="LLM and answer synthesis backend",
        ),
        postgres=RuntimeDependencyStatus(
            provider="pgvector" if isinstance(retrieval_router.vector_store, PgVectorStore) else "in-memory",
            available=isinstance(retrieval_router.vector_store, PgVectorStore),
            detail="Vector chunk storage and ingestion job persistence",
        ),
        neo4j=RuntimeDependencyStatus(
            provider="neo4j" if isinstance(retrieval_router.graph_store, Neo4jGraphStore) else "in-memory",
            available=isinstance(retrieval_router.graph_store, Neo4jGraphStore),
            detail="Equipment graph and relationship context",
        ),
        ingestion_queue_depth=sum(1 for job in jobs if job.status in {"queued", "running"}),
        fallback_modes=fallback_modes,
    )


@router.get("/impact/summary", response_model=ImpactSummaryResponse)
async def get_impact_summary() -> ImpactSummaryResponse:
    metrics = _collect_upload_metrics()
    return ImpactSummaryResponse(
        uploaded_documents=int(metrics["uploaded_documents"]),
        processed_documents=int(metrics["processed_documents"]),
        extracted_entities=int(metrics["extracted_entities"]),
        extracted_relations=int(metrics["extracted_relations"]),
        indexed_chunks=int(metrics["indexed_chunks"]),
        equipment_tags_covered=list(metrics["equipment_tags_covered"]),
        latest_upload_name=metrics["latest_upload_name"],
        basis=[
            "Counts are aggregated from staged upload records in Postgres when available.",
            "Processed documents come from persisted upload-derived extraction payloads, not demo placeholders.",
            "Indexed chunk totals come from completed ingestion job results for persisted uploads.",
        ],
    )


@router.post("/scenarios/evaluate", response_model=ScenarioEvaluation)
async def evaluate_scenario(payload: ScenarioEvaluateRequest) -> ScenarioEvaluation:
    scenarios = {
        "pump_start_readiness": {
            "title": "Can Pump 101A be started safely right now?",
            "question": "Can Pump 101A be started safely right now, and what must be verified before startup?",
            "summary": "Startup readiness scenario combining procedure, maintenance, and graph context.",
            "decision": "Hold startup until the operator verifies the cited startup checks and reviews the latest maintenance evidence.",
        },
        "overdue_inspection_override": {
            "title": "What happens if inspection is overdue but production must continue?",
            "question": "If inspection for P-101A is overdue but production must continue, what compliance risk exists and what should operators do next?",
            "summary": "Inspection override scenario for a production-vs-compliance tradeoff.",
            "decision": "Escalate for compliance review and human approval before continuing service.",
        },
    }
    selected = scenarios[payload.scenario_id]
    result = await asyncio.to_thread(
        retrieval_router.query,
        QueryRequest(question=selected["question"], top_k=5, include_graph_context=True),
    )
    return ScenarioEvaluation(
        scenario_id=payload.scenario_id,
        title=selected["title"],
        summary=selected["summary"],
        recommended_operator_decision=selected["decision"],
        query=result,
    )


@router.get("/diagnostics/evaluate", response_model=EvaluationSummaryResponse)
async def evaluate_diagnostics() -> EvaluationSummaryResponse:
    cases = [
        ("Before starting Pump 101A, what should be verified and what recent maintenance concern exists?", ["verify", "maintenance"]),
        ("When was P-101A last inspected and what compliance flags were raised?", ["inspected", "compliance"]),
        ("What governs lockout work on Feed Pump 101A?", ["lockout", "OSHA"]),
        ("What recent maintenance concern exists for P-101A?", ["maintenance", "seal"]),
        ("What equipment relationships are shown for P-101A in the diagram?", ["Pump", "valve"]),
        ("What procedure evidence supports starting Pump 101A?", ["procedure", "startup"]),
        ("Does the corpus contain inspection history for P-101A?", ["inspection"]),
        ("What cited evidence should an operator review before taking action on P-101A?", ["evidence", "operator"]),
    ]
    results: list[EvaluationCaseResult] = []
    passed = 0
    for question, fragments in cases:
        response = await asyncio.to_thread(
            retrieval_router.query,
            QueryRequest(question=question, top_k=5, include_graph_context=True),
        )
        notes: list[str] = []
        matched = sum(1 for fragment in fragments if fragment.lower() in response.answer.lower())
        if matched < max(1, len(fragments) // 2):
            notes.append("Expected answer fragments were only partially matched.")
        if not response.citations:
            notes.append("No citations returned.")
        if response.confidence < 0.35:
            notes.append("Confidence below demo threshold.")
        case_passed = matched >= max(1, len(fragments) // 2) and bool(response.citations) and response.confidence >= 0.35
        if case_passed:
            passed += 1
        results.append(
            EvaluationCaseResult(
                question=question,
                expected_fragments=fragments,
                passed=case_passed,
                confidence=response.confidence,
                citation_count=len(response.citations),
                notes=notes,
            )
        )
    total = len(results)
    return EvaluationSummaryResponse(passed=passed, total=total, score=round(passed / total if total else 0.0, 2), cases=results)


@router.get("/document/{document_id}", response_model=DocumentPayload)
async def get_document(document_id: str, locator: Optional[str] = None) -> DocumentPayload:
    staged = retrieval_router.get_staged_document(document_id)
    if staged:
        document_path = Path(staged["document_path"])
        raw_text = _slice_text_by_locator(staged["text"], locator)
        return DocumentPayload(
            document_id=document_id,
            document_name=document_path.name,
            document_type=staged["document_type"],
            content_type=_content_type(document_path),
            locator=locator,
            raw_text=raw_text,
            download_url=f"/api/document/{document_id}/file",
        )

    document_path = _find_document_path(document_id)
    if not document_path:
        raise HTTPException(status_code=404, detail="Document not found")

    document_type, text = load_any(document_path)
    content_type = _content_type(document_path)
    raw_text = _slice_text_by_locator(text, locator)
    return DocumentPayload(
        document_id=document_id,
        document_name=document_path.name,
        document_type=document_type,
        content_type=content_type,
        locator=locator,
        raw_text=raw_text,
        download_url=f"/api/document/{document_id}/file",
    )


@router.get("/document/{document_id}/file")
async def get_document_file(document_id: str) -> FileResponse:
    document_path = _find_document_path(document_id)
    if not document_path:
        raise HTTPException(status_code=404, detail="Document not found")
    return FileResponse(document_path)


# Every node label the graph merger ever creates (backend/graph/merge.py); used to
# fan a free-text search out across the whole graph regardless of entity type.
GRAPH_NODE_LABELS = [
    "Equipment",
    "Document",
    "Person",
    "Procedure",
    "RegulatoryRef",
    "InspectionEvent",
    "Parameter",
    "Organization",
    "Product",
    "Concept",
]


def _node_display_name(label: str, properties: dict) -> str:
    if label == "Equipment":
        return properties.get("display_name") or properties.get("tag") or "Equipment"
    if label == "Document":
        return properties.get("title") or properties.get("document_id") or "Document"
    if label == "RegulatoryRef":
        return properties.get("code") or properties.get("normalized_code") or "Regulatory reference"
    if label == "InspectionEvent":
        return properties.get("event_date") or properties.get("event_id") or "Event"
    if label == "Parameter":
        return properties.get("value") or properties.get("normalized_value") or "Parameter"
    return properties.get("name") or properties.get("normalized_name") or label


def _node_key(label: str, properties: dict) -> Optional[str]:
    key_fields = {
        "Equipment": "tag",
        "Document": "document_id",
        "Person": "normalized_name",
        "Procedure": "normalized_name",
        "RegulatoryRef": "normalized_code",
        "InspectionEvent": "event_id",
        "Parameter": "entity_id",
        "Organization": "normalized_name",
        "Product": "normalized_name",
        "Concept": "normalized_name",
    }
    return properties.get(key_fields.get(label, ""))


# NOTE: must be registered before /graph/{equipment_tag} below -- Starlette
# matches routes in registration order, and "search" would otherwise bind to
# the {equipment_tag} path parameter instead of reaching this route.
@router.get("/graph/search", response_model=GraphSearchResponse)
async def search_graph_nodes(q: str) -> GraphSearchResponse:
    await asyncio.to_thread(retrieval_router._bootstrap_if_needed)
    query = q.strip().lower()
    if not query:
        return GraphSearchResponse(results=[])

    results: list[GraphSearchResult] = []
    for label in GRAPH_NODE_LABELS:
        for properties in retrieval_router.graph_store.find_nodes(label):
            display_name = _node_display_name(label, properties)
            if query not in display_name.lower():
                continue
            key = _node_key(label, properties)
            if not key:
                continue
            results.append(GraphSearchResult(label=label, key=key, display_name=display_name))

    return GraphSearchResponse(results=results[:25])


@router.get("/graph/node/{label}/{key}", response_model=GraphResponse)
async def get_node_neighborhood(label: str, key: str) -> GraphResponse:
    await asyncio.to_thread(retrieval_router._bootstrap_if_needed)
    neighborhood = await asyncio.to_thread(retrieval_router.graph_store.query_node_neighborhood, label, key)
    if not neighborhood:
        raise HTTPException(status_code=404, detail="Node not found")

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    seen_nodes: set[str] = set()

    def add_node(node_id: str, node_label: str, properties: dict) -> None:
        if node_id in seen_nodes:
            return
        seen_nodes.add(node_id)
        nodes.append(GraphNode(id=node_id, label=_node_display_name(node_label, properties), kind=node_label))

    add_node(key, label, neighborhood["properties"])

    for neighbor in neighborhood["neighbors"]:
        neighbor_key = neighbor.get("key")
        if not neighbor_key:
            continue
        add_node(neighbor_key, neighbor["label"], neighbor["properties"])
        if neighbor["direction"] == "out":
            edges.append(GraphEdge(source=key, target=neighbor_key, label=neighbor["rel_type"]))
        else:
            edges.append(GraphEdge(source=neighbor_key, target=key, label=neighbor["rel_type"]))

    return GraphResponse(root_tag=key, nodes=nodes, edges=edges)


@router.get("/graph/{equipment_tag}", response_model=GraphResponse)
async def get_graph_context(equipment_tag: str) -> GraphResponse:
    await asyncio.to_thread(retrieval_router._bootstrap_if_needed)
    context = retrieval_router.graph_store.query_equipment_context(equipment_tag)
    if not context.get("equipment"):
        raise HTTPException(status_code=404, detail="Equipment node not found")

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    seen_nodes: set[str] = set()

    def add_node(node_id: str, label: str, kind: str) -> None:
        if node_id in seen_nodes:
            return
        seen_nodes.add(node_id)
        nodes.append(GraphNode(id=node_id, label=label, kind=kind))

    equipment = context["equipment"][0]
    add_node(equipment["tag"], equipment.get("display_name", equipment["tag"]), "Equipment")

    for document in context.get("documents", []):
        add_node(document["document_id"], document.get("title", document["document_id"]), "Document")
        edges.append(GraphEdge(source=equipment["tag"], target=document["document_id"], label="REFERENCED_IN"))

    for event in context.get("inspection_events", []):
        add_node(event["event_id"], event.get("event_date", event["event_id"]), "InspectionEvent")
        edges.append(GraphEdge(source=event["event_id"], target=equipment["tag"], label="PART_OF"))

    for procedure in context.get("procedures", []):
        node_id = procedure.get("entity_id", procedure.get("normalized_name", "procedure"))
        add_node(node_id, procedure.get("name", node_id), "Procedure")
        edges.append(GraphEdge(source=node_id, target=equipment["tag"], label="PART_OF"))

    for ref in context.get("regulatory_refs", []):
        node_id = ref.get("entity_id", ref.get("normalized_code", "regulatory"))
        add_node(node_id, ref.get("code", node_id), "RegulatoryRef")
        edges.append(GraphEdge(source=equipment["tag"], target=node_id, label="GOVERNED_BY"))

    return GraphResponse(root_tag=equipment_tag, nodes=nodes, edges=edges)


@router.get("/assets", response_model=AssetListResponse)
async def list_assets() -> AssetListResponse:
    await asyncio.to_thread(retrieval_router._bootstrap_if_needed)
    assets = [
        _asset_summary_from_context(node["tag"], retrieval_router.graph_store.query_equipment_context(node["tag"]))
        for node in retrieval_router.graph_store.find_nodes("Equipment")
        if node.get("tag")
    ]
    assets.sort(key=lambda item: ((item.last_event_date or ""), item.display_name), reverse=True)
    return AssetListResponse(assets=assets)


@router.get("/assets/{equipment_tag}", response_model=AssetDetail)
async def get_asset_detail(equipment_tag: str) -> AssetDetail:
    await asyncio.to_thread(retrieval_router._bootstrap_if_needed)
    context = retrieval_router.graph_store.query_equipment_context(equipment_tag)
    if not context.get("equipment"):
        raise HTTPException(status_code=404, detail="Asset not found")
    summary = _asset_summary_from_context(equipment_tag, context)
    documents = [
        {
            "document_id": document.get("document_id", ""),
            "title": document.get("title", "Document"),
            "doc_type": document.get("doc_type", "text"),
            "path": document.get("path", ""),
        }
        for document in context.get("documents", [])
    ]
    inspections = [
        {
            "event_id": event.get("event_id", ""),
            "event_date": event.get("event_date"),
            "event_type": event.get("event_type", "inspection"),
            "evidence": event.get("evidence"),
        }
        for event in context.get("inspection_events", [])
    ]
    procedures = [
        {
            "procedure_id": procedure.get("entity_id", procedure.get("normalized_name", "")),
            "name": procedure.get("name", "Procedure"),
            "source_span": procedure.get("source_span"),
        }
        for procedure in context.get("procedures", [])
    ]
    regulations = [
        {
            "regulation_id": regulation.get("entity_id", regulation.get("normalized_code", "")),
            "code": regulation.get("code", "Regulatory reference"),
            "source_span": regulation.get("source_span"),
        }
        for regulation in context.get("regulatory_refs", [])
    ]
    timeline: list[AssetTimelineItem] = []
    for event in inspections:
        timeline.append(
            AssetTimelineItem(
                item_id=str(event["event_id"]),
                item_type="inspection",
                title=f"{event.get('event_type', 'inspection').replace('_', ' ').title()} event",
                subtitle=str(event.get("evidence") or ""),
                event_date=event.get("event_date"),
            )
        )
    for document in documents:
        timeline.append(
            AssetTimelineItem(
                item_id=str(document["document_id"]),
                item_type="document",
                title=str(document["title"]),
                subtitle=str(document.get("doc_type") or "document"),
            )
        )
    for procedure in procedures:
        timeline.append(
            AssetTimelineItem(
                item_id=str(procedure["procedure_id"]),
                item_type="procedure",
                title=str(procedure["name"]),
                subtitle="Linked procedure",
            )
        )
    for regulation in regulations:
        timeline.append(
            AssetTimelineItem(
                item_id=str(regulation["regulation_id"]),
                item_type="regulation",
                title=str(regulation["code"]),
                subtitle="Applicable regulation",
            )
        )
    timeline.sort(key=lambda item: item.event_date or "", reverse=True)
    return AssetDetail(
        summary=summary,
        documents=documents,
        inspections=inspections,
        procedures=procedures,
        regulations=regulations,
        timeline=timeline,
    )


@router.get("/knowledge/documents", response_model=KnowledgeLibraryResponse)
async def list_knowledge_documents() -> KnowledgeLibraryResponse:
    staged_documents = retrieval_router.list_staged_documents()
    jobs_by_document = {
        str(job.result.get("document_id")): job
        for job in ingestion_job_manager.list_jobs()
        if isinstance(job.result, dict) and job.result.get("document_id")
    }
    documents: list[KnowledgeDocumentSummary] = []
    for staged in staged_documents:
        document_path = staged["document_path"]
        extraction = staged["extraction"]
        entities = extraction.get("entities", []) if isinstance(extraction, dict) else []
        relations = extraction.get("relations", []) if isinstance(extraction, dict) else []
        asset_tags = sorted(
            {
                tag
                for entity in entities if isinstance(entity, dict)
                for tag in [extract_canonical_tag(str(entity.get("value", "")))] if entity.get("type") == "Equipment" and tag
            }
        )
        document_id = retrieval_router.document_id_for_path(document_path)
        processing_status = "indexed" if document_id in jobs_by_document or entities or relations else "uploaded"
        documents.append(
            KnowledgeDocumentSummary(
                document_id=document_id,
                document_name=Path(document_path).name,
                document_type=staged["document_type"],
                processing_status=processing_status,
                asset_tags=asset_tags,
                entity_count=len(entities),
                relation_count=len(relations),
                source_path=document_path,
            )
        )
    documents.sort(key=lambda item: item.document_name.lower())
    return KnowledgeLibraryResponse(documents=documents)


@router.get("/actions", response_model=PendingActionResponse)
async def list_pending_actions() -> PendingActionResponse:
    return PendingActionResponse(actions=[PendingAction.model_validate(item) for item in action_manager.list_actions()])


@router.post("/actions/generate", response_model=PendingActionResponse)
async def generate_pending_actions(payload: ActionGenerateRequest) -> PendingActionResponse:
    await asyncio.to_thread(retrieval_router._bootstrap_if_needed)
    compliance_checker = ComplianceChecker(retrieval_router.graph_store)
    work_order_agent = WorkOrderDraftAgent(retrieval_router.graph_store)
    proposals = compliance_checker.check_equipment(payload.equipment_tag)
    proposals.extend(work_order_agent.draft_for_equipment(payload.equipment_tag))
    actions = action_manager.upsert_actions(proposals)
    return PendingActionResponse(actions=[PendingAction.model_validate(item) for item in actions])


@router.post("/actions/{action_id}", response_model=PendingAction)
async def update_pending_action(action_id: str, payload: ActionStatusUpdate) -> PendingAction:
    try:
        updated = action_manager.update_status(action_id, payload.status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Action not found") from exc

    if updated.get("kind") == "work_order_draft" and payload.status == "approved":
        try:
            qms_result = get_qms_connector().submit_work_order(
                {
                    "action_id": updated.get("action_id"),
                    "equipment_tag": updated.get("equipment_tag"),
                    "title": updated.get("title"),
                    "summary": updated.get("summary"),
                    "draft_text": updated.get("draft_text"),
                }
            )
            updated = action_manager.merge_details(action_id, qms_result)
        except Exception:  # noqa: BLE001 - the mock QMS call must never break approval
            logger.warning("QMS submission failed for action %s; approval still applied.", action_id, exc_info=True)

    return PendingAction.model_validate(updated)


def _find_document_path(document_id: str) -> Path | None:
    staged = retrieval_router.get_staged_document(document_id)
    if staged:
        candidate = Path(staged["document_path"])
        if candidate.exists():
            return candidate
    for path in retrieval_router.data_root.rglob("*"):
        if not path.is_file():
            continue
        if path.name in {"README.md", "verify_seed_data.py"}:
            continue
        if retrieval_router.document_id_for_path(path) == document_id:
            return path
    return None


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".svg"}:
        return "image"
    return "text"


def _count_supported_documents(root: Path) -> int:
    staged_documents = retrieval_router.list_staged_documents()
    if staged_documents:
        return len(staged_documents)
    return len(_list_source_documents(root))


def _list_source_documents(root: Path) -> list[Path]:
    if not root.exists():
        return []
    documents: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(parent.name in {"outputs", "state"} for parent in path.parents):
            continue
        if path.name in SKIP_FILENAMES:
            continue
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        documents.append(path)
    return documents


def _collect_upload_metrics() -> dict[str, object]:
    staged_documents = retrieval_router.list_staged_documents()
    source_documents = _list_source_documents(uploads_root)
    jobs = [job for job in ingestion_job_manager.list_jobs() if job.status == "completed" and job.result]

    extracted_entities = 0
    extracted_relations = 0
    equipment_tags: set[str] = set()
    processed_docs: set[str] = set()

    for payload in staged_documents:
        extraction = payload.get("extraction", {})
        entities = extraction.get("entities", []) if isinstance(extraction, dict) else []
        relations = extraction.get("relations", []) if isinstance(extraction, dict) else []
        extracted_entities += len(entities) if isinstance(entities, list) else 0
        extracted_relations += len(relations) if isinstance(relations, list) else 0
        document_path = payload.get("document_path")
        if isinstance(document_path, str):
            processed_docs.add(document_path)
        for entity in entities if isinstance(entities, list) else []:
            if isinstance(entity, dict) and entity.get("type") == "Equipment" and entity.get("value"):
                tag = extract_canonical_tag(str(entity["value"]))
                if tag:
                    equipment_tags.add(tag)

    indexed_chunks = sum(int(job.result.get("chunks_indexed", 0)) for job in jobs if isinstance(job.result, dict))
    latest_upload_name = None
    if staged_documents:
        latest_upload_name = Path(staged_documents[-1]["document_path"]).name
    elif source_documents:
        latest = max(source_documents, key=lambda path: path.stat().st_mtime)
        latest_upload_name = latest.name

    return {
        "uploaded_documents": len(staged_documents) if staged_documents else len(source_documents),
        "processed_documents": len(processed_docs) if processed_docs else len(jobs),
        "extracted_entities": extracted_entities,
        "extracted_relations": extracted_relations,
        "indexed_chunks": indexed_chunks,
        "equipment_tags_covered": sorted(equipment_tags),
        "latest_upload_name": latest_upload_name,
    }


def _asset_summary_from_context(equipment_tag: str, context: dict[str, list[dict[str, object]]]) -> AssetSummary:
    equipment = (context.get("equipment") or [{}])[0]
    documents = context.get("documents", [])
    inspections = context.get("inspection_events", [])
    procedures = context.get("procedures", [])
    regulations = context.get("regulatory_refs", [])
    last_event_date = None
    if inspections:
        dated = sorted((event.get("event_date") for event in inspections if event.get("event_date")), reverse=True)
        last_event_date = str(dated[0]) if dated else None
    display_name = str(equipment.get("display_name") or equipment.get("tag") or equipment_tag)
    if documents:
        brief = f"{display_name} is backed by {len(documents)} linked document(s), {len(inspections)} inspection event(s), and {len(procedures)} related procedure(s)."
    else:
        brief = f"{display_name} has been resolved in the knowledge graph, but supporting document coverage is still limited."
    return AssetSummary(
        tag=equipment_tag,
        display_name=display_name,
        document_count=len(documents),
        inspection_count=len(inspections),
        procedure_count=len(procedures),
        regulatory_count=len(regulations),
        last_event_date=last_event_date,
        context_status="context_available" if documents or inspections or procedures or regulations else "limited_context",
        ai_brief=brief,
    )


def _job_to_model(job: IngestionJob) -> IngestionJobModel:
    return IngestionJobModel(
        job_id=job.job_id,
        filename=job.filename,
        status=job.status,
        stages=[
            IngestionStageModel(key=stage.key, label=stage.label, status=stage.status, detail=stage.detail)
            for stage in job.stages
        ],
        error=job.error,
        result=job.result,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _disable_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"


def _unique_upload_path(filename: str) -> Path:
    candidate = uploads_root / filename
    if not candidate.exists():
        return candidate
    stem, suffix = Path(filename).stem, Path(filename).suffix
    counter = 2
    while (uploads_root / f"{stem}-{counter}{suffix}").exists():
        counter += 1
    return uploads_root / f"{stem}-{counter}{suffix}"


async def _run_ingestion_job(job_id: str, path: Path) -> None:
    manager = ingestion_job_manager
    current_stage = "upload"
    try:
        manager.start_stage(job_id, "upload")
        manager.complete_stage(job_id, "upload", detail=f"Received {path.name} ({path.stat().st_size} bytes)")

        await asyncio.to_thread(retrieval_router._bootstrap_if_needed)

        current_stage = "load"
        manager.start_stage(job_id, current_stage)
        doc_type, text = await asyncio.to_thread(load_any, path)
        manager.complete_stage(job_id, current_stage, detail=f"Loaded as '{doc_type}' ({len(text)} characters)")

        current_stage = "extract"
        manager.start_stage(job_id, current_stage)
        processed = await asyncio.to_thread(
            retrieval_router.ingestion_pipeline.process_document, path, uploads_root
        )
        entities = processed.extraction.entities
        relations = processed.extraction.relations
        manager.complete_stage(
            job_id, current_stage, detail=f"{len(entities)} entities, {len(relations)} relations extracted"
        )

        current_stage = "graph_merge"
        manager.start_stage(job_id, current_stage)
        output_json_path = retrieval_router.ingestion_pipeline.output_root / path.relative_to(uploads_root).with_suffix(
            ".json"
        )
        await asyncio.to_thread(retrieval_router.graph_merger.merge_document, output_json_path)
        equipment_tags = sorted(
            {tag for tag in (extract_canonical_tag(e.value) for e in entities if e.type == "Equipment") if tag}
        )
        manager.complete_stage(
            job_id,
            current_stage,
            detail=f"Merged into graph ({', '.join(equipment_tags) or 'no equipment tags resolved'})",
        )

        current_stage = "vector_index"
        manager.start_stage(job_id, current_stage)
        document_id = retrieval_router.document_id_for_path(path)
        chunks = await asyncio.to_thread(retrieval_router.indexer.chunk_document, path, document_id)
        await asyncio.to_thread(retrieval_router.vector_store.upsert_chunks, chunks)
        manager.complete_stage(job_id, current_stage, detail=f"Indexed {len(chunks)} chunk(s) for retrieval")

        manager.complete_job(
            job_id,
            {
                "document_id": document_id,
                "document_name": path.name,
                "entities_extracted": len(entities),
                "relations_extracted": len(relations),
                "chunks_indexed": len(chunks),
                "equipment_tags": equipment_tags,
                "entity_type_counts": _entity_type_counts(entities),
            },
        )
    except Exception as exc:  # noqa: BLE001 - surface any failure to the polling client
        manager.fail_job(job_id, current_stage, str(exc))


def _entity_type_counts(entities: list) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entity in entities:
        counts[entity.type] = counts.get(entity.type, 0) + 1
    return counts


def _slice_text_by_locator(text: str, locator: str | None) -> str:
    if not locator or not locator.startswith("chunk:"):
        return text
    try:
        chunk_index = max(int(locator.split(":", 1)[1]) - 1, 0)
    except ValueError:
        return text
    chunks = chunk_text(text)
    if chunk_index >= len(chunks):
        return text
    return chunks[chunk_index]
