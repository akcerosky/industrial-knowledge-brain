# industrial-knowledge-brain

A platform that ingests heterogeneous industrial documents, extracts entities into a knowledge graph, and exposes a citation-backed RAG copilot for operational, maintenance, and engineering workflows.

## Locked Stack

- Backend: Python + FastAPI
- Graph database: Neo4j via the official Python driver
- Vector store: Postgres + pgvector
- OCR: Tesseract first, with room to swap in PaddleOCR later
- LLM calls: Anthropic API for extraction, synthesis, and confidence scoring
- Frontend: React + Vite + Tailwind CSS, mobile-responsive and PWA-capable
- Retrieval orchestration: hand-rolled graph/vector router

## Repository Layout

```text
industrial-knowledge-brain/
├── backend/
├── frontend/
├── sample_data/
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

## Phase 0 Focus

- Create a stable ingestion contract for PDFs, scans, spreadsheets, and email exports
- Keep ontology and graph merge behavior in sync
- Stand up a hybrid retrieval path that keeps citations attached at every step
- Seed `sample_data/` with representative demo documents before extraction work begins

## Next Build Steps

1. Add Postgres and Neo4j connection settings with environment-driven configuration.
2. Implement Tesseract-backed OCR and PDF/text extraction adapters.
3. Add Anthropic-powered entity and relation extraction with confidence scores.
4. Persist chunks to pgvector and canonical entities/relations to Neo4j.
5. Wire the frontend chat flow to the FastAPI retrieval endpoints.

