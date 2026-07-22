# industrial-knowledge-brain

An Expert Knowledge Copilot that ingests heterogeneous industrial documents and exposes a citation-backed RAG experience for operational, maintenance, and engineering workflows.

## Locked Stack

- Backend: Python + FastAPI
- Graph database: Neo4j via the official Python driver
- Vector store: Postgres + pgvector
- OCR: Tesseract first, with room to swap in PaddleOCR later
- LLM calls: Google Gemini API for extraction, synthesis, and confidence scoring
- Frontend: React + Vite + Tailwind CSS, mobile-responsive and PWA-capable
- Retrieval orchestration: hand-rolled graph/vector router

## Repository Layout

```text
industrial-knowledge-brain/
├── backend/
│   └── data/          # runtime uploads + generated outputs (gitignored, empty on a fresh checkout)
├── frontend/
├── docs/
└── README.md
```

## Quick Start

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Product Focus

- Answer operational, maintenance, and engineering questions across the document corpus
- Keep every answer grounded with citations, confidence scores, and direct links to source files
- Support field technicians on mobile as well as engineers on desktop

## Current Status

- Environment-driven Postgres and Neo4j configuration is in place via `docker-compose.yml` and backend runtime env vars.
- OCR and document extraction are implemented with `pytesseract` and the ingestion loaders in `backend/ingestion/`.
- Gemini-backed extraction, embeddings, and answer synthesis are wired through `backend/llm/` and the retrieval pipeline.
- Chunks persist to pgvector and graph entities/relations persist to Neo4j when the corresponding services are configured.
- The React frontend is already connected to the FastAPI API surface, including `/api/query` and related workflow endpoints.
