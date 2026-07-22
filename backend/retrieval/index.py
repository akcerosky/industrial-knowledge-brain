from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from backend.db import get_postgres_pool
from backend.ingestion.loaders import load_any
from backend.llm.gemini_runtime import post_json_with_retry

DEFAULT_EMBEDDING_BACKEND = "local-hash-embedding"
GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
GEMINI_HOST = "https://generativelanguage.googleapis.com"
EMBEDDING_DIMENSION = 768
TOKEN_WINDOW = 500
TOKEN_OVERLAP = 100


@dataclass
class DocumentChunk:
    id: str
    document_id: str
    chunk_text: str
    embedding: list[float]
    metadata: dict[str, Any]


class VectorStore:
    def ensure_schema(self) -> None:
        raise NotImplementedError

    def upsert_chunks(self, chunks: list[DocumentChunk]) -> None:
        raise NotImplementedError

    def search(self, query_embedding: list[float], top_k: int) -> list[tuple[DocumentChunk, float]]:
        raise NotImplementedError

    def count_chunks(self) -> int:
        raise NotImplementedError


class InMemoryVectorStore(VectorStore):
    def __init__(self) -> None:
        self.chunks: dict[str, DocumentChunk] = {}

    def ensure_schema(self) -> None:
        return

    def upsert_chunks(self, chunks: list[DocumentChunk]) -> None:
        for chunk in chunks:
            self.chunks[chunk.id] = chunk

    def search(self, query_embedding: list[float], top_k: int) -> list[tuple[DocumentChunk, float]]:
        scored = [
            (chunk, cosine_similarity(query_embedding, chunk.embedding))
            for chunk in self.chunks.values()
        ]
        return sorted(scored, key=lambda item: item[1], reverse=True)[:top_k]

    def count_chunks(self) -> int:
        return len(self.chunks)


class PgVectorStore(VectorStore):
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL")
        self._pool = get_postgres_pool(self.database_url, max_size=6)

    def ensure_schema(self) -> None:
        if not self.database_url:
            return
        try:
            import psycopg
        except ImportError:
            return
        pool = self._pool or get_postgres_pool(self.database_url, max_size=6)
        if not pool:
            return
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
                cursor.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id text PRIMARY KEY,
                        document_id text NOT NULL,
                        chunk_text text NOT NULL,
                        embedding vector({EMBEDDING_DIMENSION}) NOT NULL,
                        metadata jsonb NOT NULL
                    )
                    """
                )
                cursor.execute("CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx ON document_chunks (document_id)")
            connection.commit()

    def upsert_chunks(self, chunks: list[DocumentChunk]) -> None:
        if not self.database_url or not chunks:
            return
        try:
            import psycopg
        except ImportError:
            return

        self.ensure_schema()
        pool = self._pool or get_postgres_pool(self.database_url, max_size=6)
        if not pool:
            return
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                for chunk in chunks:
                    cursor.execute(
                        """
                        INSERT INTO document_chunks (id, document_id, chunk_text, embedding, metadata)
                        VALUES (%s, %s, %s, %s, %s::jsonb)
                        ON CONFLICT (id) DO UPDATE SET
                            document_id = EXCLUDED.document_id,
                            chunk_text = EXCLUDED.chunk_text,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata
                        """,
                        (
                            chunk.id,
                            chunk.document_id,
                            chunk.chunk_text,
                            _pgvector_literal(chunk.embedding),
                            json.dumps(chunk.metadata),
                        ),
                    )
            connection.commit()

    def search(self, query_embedding: list[float], top_k: int) -> list[tuple[DocumentChunk, float]]:
        if not self.database_url:
            return []
        try:
            import psycopg
        except ImportError:
            return []

        self.ensure_schema()
        query_literal = _pgvector_literal(query_embedding)
        pool = self._pool or get_postgres_pool(self.database_url, max_size=6)
        if not pool:
            return []
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, document_id, chunk_text, metadata, 1 - (embedding <=> %s::vector) AS score
                    FROM document_chunks
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (query_literal, query_literal, top_k),
                )
                rows = cursor.fetchall()

        return [
            (
                DocumentChunk(
                    id=row[0],
                    document_id=row[1],
                    chunk_text=row[2],
                    embedding=[],
                    metadata=row[3],
                ),
                float(row[4]),
            )
            for row in rows
        ]

    def count_chunks(self) -> int:
        if not self.database_url:
            return 0
        try:
            import psycopg
        except ImportError:
            return 0

        self.ensure_schema()
        pool = self._pool or get_postgres_pool(self.database_url, max_size=6)
        if not pool:
            return 0
        with pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM document_chunks")
                row = cursor.fetchone()
        return int(row[0]) if row else 0


class EmbeddingModel:
    """Real embeddings via the Gemini API when GEMINI_API_KEY is configured;
    otherwise a deterministic hash-bucket fallback so retrieval still works
    offline (e.g. in tests, or if the key is missing/the call fails)."""

    def __init__(self, backend_name: str | None = None) -> None:
        self.backend_name = backend_name or os.getenv("GEMINI_EMBEDDING_MODEL", GEMINI_EMBEDDING_MODEL)
        self.host = os.getenv("GEMINI_HOST", GEMINI_HOST)
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.last_fallback_reason: str | None = None

    def embed_text(self, text: str) -> list[float]:
        if os.getenv("DISABLE_LLM") == "1" or not self.api_key:
            self.last_fallback_reason = "llm_disabled"
            return self._embed_with_hash(text)
        try:
            self.last_fallback_reason = None
            return self._embed_with_gemini(text)
        except Exception as exc:
            # Gemini being unreachable/rate-limited shouldn't take down
            # ingestion or querying — degrade to the deterministic fallback
            # for this call only.
            self.last_fallback_reason = exc.__class__.__name__
            return self._embed_with_hash(text)

    def _embed_with_gemini(self, text: str) -> list[float]:
        result = post_json_with_retry(
            f"{self.host}/v1beta/models/{self.backend_name}:embedContent",
            params={"key": self.api_key},
            json={
                "content": {"parts": [{"text": text or " "}]},
                "outputDimensionality": EMBEDDING_DIMENSION,
            },
            timeout=60.0,
        )
        vector = result.response.json()["embedding"]["values"]
        return _normalize(vector)

    def _embed_with_hash(self, text: str) -> list[float]:
        tokens = re.findall(r"[a-z0-9\-]+", text.lower())
        vector = [0.0] * EMBEDDING_DIMENSION
        for token in tokens:
            bucket = int(hashlib.sha1(token.encode("utf-8")).hexdigest(), 16) % EMBEDDING_DIMENSION
            vector[bucket] += 1.0
        return _normalize(vector)


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


class ChunkIndexer:
    def __init__(self, embedding_model: EmbeddingModel | None = None) -> None:
        self.embedding_model = embedding_model or EmbeddingModel()

    def chunk_document(self, path: Path, document_id: str) -> list[DocumentChunk]:
        doc_type, text = load_any(path)
        return self.chunk_text_content(
            document_id=document_id,
            document_name=path.name,
            document_path=str(path),
            document_type=doc_type,
            text=text,
        )

    def chunk_text_content(
        self,
        document_id: str,
        document_name: str,
        document_path: str,
        document_type: str,
        text: str,
    ) -> list[DocumentChunk]:
        chunks = chunk_text(text)
        return [
            DocumentChunk(
                id=stable_chunk_id(document_id, index),
                document_id=document_id,
                chunk_text=chunk,
                embedding=self.embedding_model.embed_text(chunk),
                metadata={
                    "document_name": document_name,
                    "document_path": document_path,
                    "document_type": document_type,
                    "locator": f"chunk:{index + 1}",
                },
            )
            for index, chunk in enumerate(chunks)
        ]


def chunk_text(text: str, token_window: int = TOKEN_WINDOW, token_overlap: int = TOKEN_OVERLAP) -> list[str]:
    tokens = text.split()
    if not tokens:
        return []
    step = max(token_window - token_overlap, 1)
    chunks: list[str] = []
    for start in range(0, len(tokens), step):
        window = tokens[start : start + token_window]
        if not window:
            continue
        chunks.append(" ".join(window))
        if start + token_window >= len(tokens):
            break
    return chunks


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    return sum(l * r for l, r in zip(left, right))


def stable_chunk_id(document_id: str, index: int) -> str:
    digest = hashlib.sha1(f"{document_id}:{index}".encode("utf-8")).hexdigest()[:12]
    return f"chunk-{digest}"


def _pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"
