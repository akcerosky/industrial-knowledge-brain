from models.schemas import Citation, Entity, QueryRequest, QueryResponse


class HybridRetrievalRouter:
    """Temporary retrieval stub until pgvector and Neo4j are connected."""

    def query(self, request: QueryRequest) -> QueryResponse:
        stub_entity = Entity(
            entity_id="asset-demo-p-101",
            canonical_name="Pump P-101",
            entity_type="Asset",
            confidence=0.82,
            source_document_id="doc-demo-manual",
        )
        stub_citation = Citation(
            document_id="doc-demo-manual",
            excerpt="Pump P-101 requires seal inspection every 1,500 operating hours.",
            locator="page:12",
            confidence=0.89,
        )
        return QueryResponse(
            answer=(
                "This is a scaffolded response. The hybrid router will later combine "
                "graph expansion, vector retrieval, and Anthropic synthesis for: "
                f"{request.question}"
            ),
            citations=[stub_citation],
            entities=[stub_entity],
        )

