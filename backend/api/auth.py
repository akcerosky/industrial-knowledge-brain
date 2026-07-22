"""Optional API-key authentication for the API router.

This is intentionally minimal: a single shared secret checked against the
`X-API-Key` request header. It is meant as a starting point, not a real
authn/authz system (see SCALABILITY.md).

Behavior:
- If the `API_KEY` environment variable is unset or empty (the default),
  `require_api_key` is a complete no-op -- every request passes through
  unchanged. This is the current state of this environment, and it means
  nothing that works today breaks when this dependency is wired in.
- If `API_KEY` is set, requests must include a matching `X-API-Key` header
  or they get a 401.

Wired in `backend/main.py` as a dependency on the whole `api_router` (via
`include_router(..., dependencies=[Depends(require_api_key)])`), so the
bare `/health` endpoint declared directly on the FastAPI app stays
unauthenticated for container health checks.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import Header, HTTPException, status


def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    expected = os.getenv("API_KEY")
    if not expected:
        # No API key configured -- auth is disabled, do nothing.
        return
    if x_api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-API-Key header.",
        )
