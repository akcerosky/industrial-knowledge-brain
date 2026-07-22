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

## Next Build Steps

1. Add Postgres and Neo4j connection settings with environment-driven configuration.
2. Implement Tesseract-backed OCR and PDF/text extraction adapters.
3. Add Gemini-powered entity and relation extraction with confidence scores.
4. Persist chunks to pgvector and canonical entities/relations to Neo4j.
5. Wire the frontend chat flow to the FastAPI retrieval endpoints.
