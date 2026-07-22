from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import Depends, FastAPI  # noqa: E402

from backend.api.auth import require_api_key  # noqa: E402
from backend.api.routes import router as api_router  # noqa: E402


app = FastAPI(
    title="Expert Knowledge Copilot API",
    version="0.1.0",
    description="Hybrid graph and vector retrieval for industrial knowledge questions with grounded source evidence.",
)

# Optional API-key auth (no-op unless API_KEY is set -- see backend/api/auth.py).
# Applied to the whole api_router; /health below stays open for container
# health checks.
app.include_router(api_router, prefix="/api", dependencies=[Depends(require_api_key)])


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
