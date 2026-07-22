from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class GeminiCallResult:
    response: httpx.Response
    attempts: int
    degraded: bool


class _GeminiLimiter:
    def __init__(self, max_calls_per_window: int = 6, window_seconds: float = 1.0) -> None:
        self.max_calls_per_window = max_calls_per_window
        self.window_seconds = window_seconds
        self._timestamps: list[float] = []
        self._lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            wait_for = 0.0
            with self._lock:
                now = time.monotonic()
                self._timestamps = [stamp for stamp in self._timestamps if now - stamp < self.window_seconds]
                if len(self._timestamps) < self.max_calls_per_window:
                    self._timestamps.append(now)
                    return
                wait_for = self.window_seconds - (now - self._timestamps[0])
            time.sleep(max(wait_for, 0.05))


_LIMITER = _GeminiLimiter()


def post_json_with_retry(url: str, *, params: dict[str, Any], json: dict[str, Any], timeout: float) -> GeminiCallResult:
    attempts = 0
    degraded = False
    last_error: Exception | None = None

    for backoff in (0.0, 0.4, 1.0):
        if backoff:
            time.sleep(backoff)
        _LIMITER.acquire()
        attempts += 1
        try:
            response = httpx.post(url, params=params, json=json, timeout=timeout)
            if response.status_code in {429, 500, 502, 503, 504}:
                degraded = True
                last_error = httpx.HTTPStatusError(
                    f"Gemini transient failure {response.status_code}",
                    request=response.request,
                    response=response,
                )
                logger.warning("Gemini transient failure status=%s attempt=%s", response.status_code, attempts)
                continue
            response.raise_for_status()
            return GeminiCallResult(response=response, attempts=attempts, degraded=degraded)
        except httpx.HTTPError as exc:
            degraded = True
            last_error = exc
            logger.warning("Gemini request failed attempt=%s error=%s", attempts, exc)
            continue

    if last_error:
        raise last_error
    raise RuntimeError("Gemini request failed without a concrete error")
