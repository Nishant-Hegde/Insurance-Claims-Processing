"""Shared sentence-embedding model for ClaimGuard.

Used by the FastAPI service (app.py) and by the database scripts in scripts/,
so every vector in the database comes from exactly the same model and settings.

The model name and version are what the database stores in embedding_model.
Similarity search only compares vectors with the same embedding_model_id, so
changing either value means the reference cases must be re-embedded
(see scripts/reembed_reference_cases.py).
"""
from __future__ import annotations

import os
from functools import lru_cache

# Hugging Face model id loaded by sentence-transformers.
HF_MODEL_ID = os.environ.get("EMBEDDING_HF_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

# Identity recorded in the embedding_model table. "normalized-v1" = L2-normalised
# 384-dim output of the model above, mean pooling (the model's default).
MODEL_NAME = os.environ.get("EMBEDDING_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")
MODEL_VERSION = os.environ.get("EMBEDDING_MODEL_VERSION", "normalized-v1")
DIMENSION = 384  # fixed by vector(384) in claimguard_schema_v4.sql

MAX_TEXT_CHARS = 5000


@lru_cache(maxsize=1)
def get_model():
    """Loads the model once per process (first call downloads it, ~90 MB)."""
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(HF_MODEL_ID, device="cpu")
    dim = model.get_embedding_dimension()
    if dim != DIMENSION:
        raise RuntimeError(f"{HF_MODEL_ID} produces {dim}-dim vectors; the schema expects {DIMENSION}")
    return model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Returns one L2-normalised 384-dim vector per text."""
    vectors = get_model().encode(
        texts,
        normalize_embeddings=True,   # unit length: cosine similarity = dot product
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return [[float(x) for x in v] for v in vectors]


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]


def to_pgvector(vector: list[float]) -> str:
    """Formats a vector as a pgvector text literal, e.g. '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.8f}" for x in vector) + "]"
