# syntax=docker/dockerfile:1

# --- Build stage: install Python deps into a virtualenv-like prefix -------
FROM python:3.12-slim AS builder

WORKDIR /build

# System packages needed to *build* some wheels (kept out of the final image).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# --- Runtime stage ----------------------------------------------------------
FROM python:3.12-slim AS runtime

# tesseract-ocr and poppler-utils are required at runtime by pytesseract and
# pdfplumber respectively (OCR + PDF text/table extraction in the ingestion
# pipeline).
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Repo root is the WORKDIR so the app is importable as `backend.main:app`,
# matching how it is already run locally: `python -m uvicorn backend.main:app`
# from the repo root (not from inside backend/).
WORKDIR /app

COPY --from=builder /install /usr/local

# Only copy the backend/ package -- this image does not need the frontend or
# other repo directories.
COPY backend/ ./backend/

# Non-root runtime user.
RUN groupadd --system app && useradd --system --gid app --no-create-home app \
    && chown -R app:app /app
USER app

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
