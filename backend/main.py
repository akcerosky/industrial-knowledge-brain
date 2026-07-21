from fastapi import FastAPI

from api.routes import router as api_router


app = FastAPI(
    title="Industrial Knowledge Brain API",
    version="0.1.0",
    description="Hybrid graph and vector retrieval for industrial knowledge workflows.",
)

app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}

