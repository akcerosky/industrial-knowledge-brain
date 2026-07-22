# Clean Architecture Diagram

This version is a simplified, presentation-friendly view of the current system for the **Expert Knowledge Copilot**. It focuses on the main runtime flow: document ingestion, hybrid retrieval, cited answer generation, and human-reviewed operational actions.

```mermaid
flowchart LR
    classDef client fill:#E8F1FB,stroke:#2F6DB3,color:#163B63,stroke-width:1.5px;
    classDef service fill:#F7F9FC,stroke:#5B6B7A,color:#1E2933,stroke-width:1.2px;
    classDef ai fill:#FFF3D6,stroke:#C68A00,color:#6B4A00,stroke-width:1.2px;
    classDef data fill:#E8F7EE,stroke:#2E8B57,color:#1D4D34,stroke-width:1.2px;
    classDef external fill:#FCEBEC,stroke:#C04B5A,color:#6B2230,stroke-width:1.2px;

    U["Field Technicians<br/>Engineers<br/>Operations Teams"]:::client

    subgraph FE["Frontend Experience"]
        Chat["Chat UI"]:::client
        Ingest["Ingestion UI"]:::client
        Graph["Graph Explorer"]:::client
        Actions["Pending Actions"]:::client
        Docs["Document Viewer"]:::client
    end

    subgraph API["FastAPI Backend"]
        Gateway["API Routes<br/>query, ingest, graph, actions, documents"]:::service
        Auth["API Key Guard<br/>(optional)"]:::service
    end

    subgraph ING["Knowledge Ingestion Pipeline"]
        Load["Document Loaders<br/>PDF, CSV, Email, Text, SVG"]:::service
        Extract["Structured Extraction<br/>rules + LLM enrichment"]:::ai
        Vision["P&ID SVG Interpreter"]:::ai
        GraphMerge["Entity + Relation Merge"]:::service
        Chunk["Chunking + Embeddings"]:::service
    end

    subgraph RET["Query and Reasoning"]
        Router["Hybrid Retrieval Router"]:::service
        GraphSearch["Graph Retrieval"]:::service
        VectorSearch["Vector Retrieval"]:::service
        Synthesis["Answer Synthesis<br/>citations + confidence"]:::ai
    end

    subgraph OPS["Operational Copilot Actions"]
        Compliance["Compliance Check Agent"]:::ai
        WorkOrder["Work Order Draft Agent"]:::ai
        Review["Human Review Queue"]:::service
    end

    subgraph DATA["Knowledge Stores"]
        Neo4j[("Neo4j<br/>knowledge graph")]:::data
        PgVector[("Postgres + pgvector<br/>semantic chunks")]:::data
        SourceFiles[("Source documents")]:::data
    end

    subgraph EXT["External Intelligence / Systems"]
        Gemini["Gemini API<br/>extraction, embeddings, synthesis"]:::external
        QMS["QMS Connector<br/>(mock today, real later)"]:::external
    end

    U --> Chat
    U --> Ingest
    U --> Graph
    U --> Actions
    U --> Docs

    Chat --> Gateway
    Ingest --> Gateway
    Graph --> Gateway
    Actions --> Gateway
    Docs --> Gateway

    Auth --> Gateway

    Gateway --> Load
    Load --> SourceFiles
    Load --> Extract
    Extract --> Vision
    Extract --> GraphMerge
    Vision --> GraphMerge
    Extract --> Chunk
    GraphMerge --> Neo4j
    Chunk --> PgVector
    Extract --> Gemini
    Vision --> Gemini
    Chunk --> Gemini

    Gateway --> Router
    Router --> GraphSearch
    Router --> VectorSearch
    GraphSearch --> Neo4j
    VectorSearch --> PgVector
    GraphSearch --> Synthesis
    VectorSearch --> Synthesis
    Synthesis --> Gemini
    Synthesis --> Gateway

    Gateway --> Compliance
    Gateway --> WorkOrder
    Compliance --> Neo4j
    Compliance --> Gemini
    WorkOrder --> Neo4j
    WorkOrder --> Review
    Compliance --> Review
    Review --> QMS
```

## What this diagram emphasizes

- The product is a **RAG-powered industrial copilot**, not just a chatbot.
- Documents are transformed into **two complementary knowledge layers**:
  - a **knowledge graph** in Neo4j for entities, assets, procedures, and relationships
  - a **vector index** in pgvector for semantic search over document chunks
- User questions run through **hybrid retrieval**, then an LLM synthesizes a response with **citations and confidence**.
- Operational outputs such as compliance flags and work-order drafts are **human reviewed before action**.
- The UI supports both **mobile field usage** and **desktop engineering workflows**.
