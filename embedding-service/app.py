"""ClaimGuard embedding service.

    POST /embed   {"text": "..."} -> {model_name, model_version, dimension, embedding}
    GET  /health  -> model status

Run (from embedding-service/):
    .venv\\Scripts\\python -m uvicorn app:app --host 127.0.0.1 --port %EMBEDDING_PORT%
or simply:
    .venv\\Scripts\\python app.py        (uses EMBEDDING_PORT, default 8001)

The service holds no data and never touches the database. The Next.js backend calls it
and passes the vector to the database (sp_screen_claim / reference-case inserts).
"""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

import embedder

_state: dict[str, object] = {"ready": False, "load_seconds": None, "error": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load the model once at startup so the first request is not slow.
    started = time.perf_counter()
    try:
        await run_in_threadpool(embedder.get_model)
        _state["ready"] = True
        _state["load_seconds"] = round(time.perf_counter() - started, 2)
    except Exception as exc:  # keep running so /health can report the problem
        _state["error"] = str(exc)
    yield


app = FastAPI(title="ClaimGuard embedding service", version="1.0.0", lifespan=lifespan)


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=embedder.MAX_TEXT_CHARS)


class EmbedResponse(BaseModel):
    model_name: str
    model_version: str
    dimension: int
    embedding: list[float]


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok" if _state["ready"] else "unavailable",
        "model_name": embedder.MODEL_NAME,
        "model_version": embedder.MODEL_VERSION,
        "dimension": embedder.DIMENSION,
        "load_seconds": _state["load_seconds"],
        "error": _state["error"],
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    if not _state["ready"]:
        raise HTTPException(status_code=503, detail="embedding model is not loaded")
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text must not be blank")
    vector = await run_in_threadpool(embedder.embed_text, text)
    return EmbedResponse(
        model_name=embedder.MODEL_NAME,
        model_version=embedder.MODEL_VERSION,
        dimension=len(vector),
        embedding=vector,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("EMBEDDING_HOST", "127.0.0.1"),
                port=int(os.environ.get("EMBEDDING_PORT", "8001")))
