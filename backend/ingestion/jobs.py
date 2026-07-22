from __future__ import annotations

import json
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Literal, Optional

from backend.db import get_postgres_pool

StageStatus = Literal["pending", "running", "completed", "failed"]
JobStatus = Literal["queued", "running", "completed", "failed"]

STAGE_DEFS: list[tuple[str, str]] = [
    ("upload", "Receive file"),
    ("load", "Load & OCR"),
    ("extract", "Extract entities & relations"),
    ("graph_merge", "Merge into knowledge graph"),
    ("vector_index", "Chunk & index for retrieval"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class IngestionStage:
    key: str
    label: str
    status: StageStatus = "pending"
    detail: Optional[str] = None


@dataclass
class IngestionJob:
    job_id: str
    filename: str
    status: JobStatus = "queued"
    stages: list[IngestionStage] = field(default_factory=list)
    error: Optional[str] = None
    result: Optional[dict[str, Any]] = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)


class IngestionJobManager:
    """Job tracker for the demo upload pipeline with optional on-disk persistence."""

    def __init__(self, storage_path: Path | None = None) -> None:
        self._jobs: dict[str, IngestionJob] = {}
        self._storage_path = storage_path
        self._lock = RLock()
        self._database_url = os.getenv("DATABASE_URL")
        self._pool = get_postgres_pool(self._database_url, max_size=4)
        self._schema_ready = False
        self._load()

    def create_job(self, filename: str) -> IngestionJob:
        with self._lock:
            job = IngestionJob(
                job_id=str(uuid.uuid4()),
                filename=filename,
                stages=[IngestionStage(key=key, label=label) for key, label in STAGE_DEFS],
            )
            self._jobs[job.job_id] = job
            self._persist_locked()
            return self._copy_job(job)

    def get_job(self, job_id: str) -> Optional[IngestionJob]:
        with self._lock:
            job = self._jobs.get(job_id)
            return self._copy_job(job) if job else None

    def list_jobs(self) -> list[IngestionJob]:
        with self._lock:
            return [self._copy_job(job) for job in self._jobs.values()]

    def start_stage(self, job_id: str, stage_key: str) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.status = "running"
            for stage in job.stages:
                if stage.key == stage_key:
                    stage.status = "running"
            job.updated_at = _now()
            self._persist_locked()

    def complete_stage(self, job_id: str, stage_key: str, detail: str | None = None) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for stage in job.stages:
                if stage.key == stage_key:
                    stage.status = "completed"
                    stage.detail = detail
            job.updated_at = _now()
            self._persist_locked()

    def fail_job(self, job_id: str, stage_key: str, error: str) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.status = "failed"
            job.error = error
            for stage in job.stages:
                if stage.key == stage_key:
                    stage.status = "failed"
                    stage.detail = error
            job.updated_at = _now()
            self._persist_locked()

    def complete_job(self, job_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.status = "completed"
            job.result = result
            job.updated_at = _now()
            self._persist_locked()

    def _copy_job(self, job: IngestionJob) -> IngestionJob:
        return IngestionJob(
            job_id=job.job_id,
            filename=job.filename,
            status=job.status,
            stages=[IngestionStage(key=stage.key, label=stage.label, status=stage.status, detail=stage.detail) for stage in job.stages],
            error=job.error,
            result=dict(job.result) if job.result else None,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    def _load(self) -> None:
        if self._pool:
            self._ensure_db_schema()
            self._load_from_db()
            return
        if not self._storage_path or not self._storage_path.exists():
            return
        try:
            payload = json.loads(self._storage_path.read_text())
        except (OSError, json.JSONDecodeError):
            return

        jobs = payload.get("jobs", [])
        if not isinstance(jobs, list):
            return

        for raw_job in jobs:
            if not isinstance(raw_job, dict):
                continue
            job_id = raw_job.get("job_id")
            filename = raw_job.get("filename")
            raw_stages = raw_job.get("stages", [])
            if not job_id or not filename or not isinstance(raw_stages, list):
                continue
            self._jobs[str(job_id)] = IngestionJob(
                job_id=str(job_id),
                filename=str(filename),
                status=raw_job.get("status", "queued"),
                stages=[
                    IngestionStage(
                        key=str(stage.get("key", "")),
                        label=str(stage.get("label", "")),
                        status=stage.get("status", "pending"),
                        detail=stage.get("detail"),
                    )
                    for stage in raw_stages
                    if isinstance(stage, dict)
                ],
                error=raw_job.get("error"),
                result=raw_job.get("result"),
                created_at=raw_job.get("created_at", _now()),
                updated_at=raw_job.get("updated_at", _now()),
            )

    def _persist_locked(self) -> None:
        if self._pool:
            self._ensure_db_schema()
            self._persist_to_db_locked()
            return
        if not self._storage_path:
            return
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._storage_path.with_suffix(f"{self._storage_path.suffix}.tmp")
        payload = {"jobs": [asdict(job) for job in self._jobs.values()]}
        temp_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
        temp_path.replace(self._storage_path)

    def _ensure_db_schema(self) -> None:
        if not self._pool or self._schema_ready:
            return
        try:
            with self._pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS ingestion_jobs (
                            job_id text PRIMARY KEY,
                            filename text NOT NULL,
                            status text NOT NULL,
                            stages jsonb NOT NULL,
                            error text NULL,
                            result jsonb NULL,
                            created_at text NOT NULL,
                            updated_at text NOT NULL
                        )
                        """
                    )
                connection.commit()
            self._schema_ready = True
        except Exception:
            self._pool = None

    def _load_from_db(self) -> None:
        if not self._pool:
            return
        try:
            with self._pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT job_id, filename, status, stages, error, result, created_at, updated_at
                        FROM ingestion_jobs
                        """
                    )
                    rows = cursor.fetchall()
        except Exception:
            self._pool = None
            return

        for row in rows:
            raw_stages = row[3] or []
            self._jobs[str(row[0])] = IngestionJob(
                job_id=str(row[0]),
                filename=str(row[1]),
                status=row[2],
                stages=[
                    IngestionStage(
                        key=str(stage.get("key", "")),
                        label=str(stage.get("label", "")),
                        status=stage.get("status", "pending"),
                        detail=stage.get("detail"),
                    )
                    for stage in raw_stages
                    if isinstance(stage, dict)
                ],
                error=row[4],
                result=row[5],
                created_at=row[6],
                updated_at=row[7],
            )

    def _persist_to_db_locked(self) -> None:
        if not self._pool:
            return
        try:
            with self._pool.connection() as connection:
                with connection.cursor() as cursor:
                    for job in self._jobs.values():
                        cursor.execute(
                            """
                            INSERT INTO ingestion_jobs (
                                job_id, filename, status, stages, error, result, created_at, updated_at
                            ) VALUES (%s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s)
                            ON CONFLICT (job_id) DO UPDATE SET
                                filename = EXCLUDED.filename,
                                status = EXCLUDED.status,
                                stages = EXCLUDED.stages,
                                error = EXCLUDED.error,
                                result = EXCLUDED.result,
                                created_at = EXCLUDED.created_at,
                                updated_at = EXCLUDED.updated_at
                            """,
                            (
                                job.job_id,
                                job.filename,
                                job.status,
                                json.dumps([asdict(stage) for stage in job.stages]),
                                job.error,
                                json.dumps(job.result) if job.result is not None else None,
                                job.created_at,
                                job.updated_at,
                            ),
                        )
                connection.commit()
        except Exception:
            self._pool = None
