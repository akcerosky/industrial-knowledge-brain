# Project Architecture

This diagram reflects the current code in `industrial-knowledge-brain` as of July 22, 2026.

```mermaid
flowchart LR
    classDef client fill:#EAF3FF,stroke:#2E6DA4,color:#17324D,stroke-width:1.2px;
    classDef service fill:#F7F8FA,stroke:#667085,color:#1F2937,stroke-width:1.2px;
    classDef data fill:#EAF8EF,stroke:#2F855A,color:#1C4532,stroke-width:1.2px;
    classDef ai fill:#FFF6E5,stroke:#C2870A,color:#6B4F00,stroke-width:1.2px;
    classDef ext fill:#FDECEC,stroke:#C05666,color:#742A2A,stroke-width:1.2px;

    User["Operators, Engineers, Technicians"]:::client

    subgraph Frontend["Frontend: React + Vite"]
        Chat["Chat"]:::client
        Ingest["Ingest"]:::client
        Graph["Graph Explorer"]:::client
        Viewer["Document Viewer"]:::client
        ActionsUI["Pending Actions"]:::client
    end

    subgraph Backend["Backend: FastAPI"]
        Health["/health"]:::service
        Auth["API key guard<br/>for /api routes"]:::service
        Status["/api/status<br/>/api/status/runtime"]:::service
        Query["/api/query"]:::service
        Upload["/api/ingest<br/>/api/ingest/upload"]:::service
        JobStatus["/api/ingest/upload/{job_id}"]:::service
        GraphAPI["/api/graph/*"]:::service
        DocAPI["/api/document/*"]:::service
        ActionAPI["/api/actions/*"]:::service
        Impact["/api/impact/summary<br/>/api/scenarios/evaluate"]:::service
    end

    subgraph Ingestion["Document Ingestion Pipeline"]
        Loaders["Loaders<br/>PDF, CSV/XLSX, email, text, SVG"]:::service
        Extract["Hybrid extraction<br/>rules + Gemini structured output"]:::ai
        Vision["P&ID SVG interpretation"]:::ai
        Stage["Stage writer"]:::service
        GraphMerge["Graph merge / incremental update"]:::service
        Chunking["Chunking + embeddings"]:::service
        Jobs["Ingestion job manager"]:::service
    end

    subgraph Retrieval["Hybrid Retrieval + Answering"]
        Router["Hybrid retrieval router"]:::service
        GraphPath["Graph path"]:::service
        VectorPath["Vector path"]:::service
        Synthesis["Answer synthesizer<br/>citations + confidence"]:::ai
    end

    subgraph Agents["Operational Agents"]
        Compliance["Compliance checker"]:::ai
        WorkOrder["Work-order draft agent"]:::ai
        Review["Pending action manager"]:::service
    end

    subgraph Data["State and Knowledge Stores"]
        SourceDocs[("Source documents")]:::data
        Outputs[("Extracted JSON outputs")]:::data
        StateFiles[("State JSON files<br/>jobs + pending actions")]:::data
        Neo4j[("Neo4j graph store")]:::data
        PgVector[("Postgres + pgvector")]:::data
        StageTable[("Postgres extraction_staging")]:::data
    end

    subgraph External["External Services"]
        Gemini["Gemini API<br/>chat + embeddings"]:::ext
        QMS["QMS connector<br/>(mock integration)"]:::ext
    end

    User --> Chat
    User --> Ingest
    User --> Graph
    User --> Viewer
    User --> ActionsUI

    Chat --> Query
    Ingest --> Upload
    Graph --> GraphAPI
    Viewer --> DocAPI
    ActionsUI --> ActionAPI

    Health:::service
    Auth --> Status
    Auth --> Query
    Auth --> Upload
    Auth --> JobStatus
    Auth --> GraphAPI
    Auth --> DocAPI
    Auth --> ActionAPI
    Auth --> Impact

    Upload --> Jobs
    JobStatus --> Jobs
    Upload --> Loaders
    Loaders --> SourceDocs
    Loaders --> Extract
    Extract --> Vision
    Extract --> Stage
    Extract --> GraphMerge
    Vision --> GraphMerge
    Extract --> Chunking
    GraphMerge --> Outputs
    Chunking --> Outputs
    Jobs --> StateFiles
    Stage --> StageTable
    GraphMerge --> Neo4j
    Chunking --> PgVector
    Extract --> Gemini
    Vision --> Gemini
    Chunking --> Gemini

    Query --> Router
    Status --> Router
    Impact --> Router
    Router --> GraphPath
    Router --> VectorPath
    GraphPath --> Neo4j
    VectorPath --> PgVector
    GraphPath --> Synthesis
    VectorPath --> Synthesis
    Synthesis --> Gemini

    ActionAPI --> Compliance
    ActionAPI --> WorkOrder
    Compliance --> Neo4j
    Compliance --> Gemini
    WorkOrder --> Neo4j
    Compliance --> Review
    WorkOrder --> Review
    Review --> StateFiles
    Review --> QMS
```

## Notes

- The frontend is a single React app with dedicated pages for chat, ingestion, graph exploration, document viewing, and pending actions.
- FastAPI exposes the API, with `/health` left open and `/api/*` protected by the optional API-key dependency.
- Ingestion creates two knowledge layers: a graph in Neo4j and vector chunks in Postgres/pgvector.
- Query answering uses both retrieval paths, then synthesizes a cited answer with confidence and follow-up actions.
- Jobs and pending actions are persisted in JSON state files under `backend/data/state`, while extraction staging is optionally written to Postgres.
