"""
Embedding abstraction for the BOFiP RAG layer.

Primary:  voyage-3 via voyageai SDK (VOYAGE_API_KEY env var)
Fallback: sentence-transformers/paraphrase-multilingual-mpnet-base-v2 (local)

Both expose the same interface:
  embed(texts: list[str]) -> list[list[float]]
  embed_query(text: str) -> list[float]
  dim: int
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

VOYAGE_DIM = 1024
SBERT_DIM = 768
SBERT_MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"


class VoyageEmbedder:
    dim = VOYAGE_DIM

    def __init__(self, api_key: Optional[str] = None) -> None:
        try:
            import voyageai
        except ImportError:
            raise ImportError("pip install voyageai")
        self._client = voyageai.Client(api_key=api_key or os.environ["VOYAGE_API_KEY"])

    def embed(self, texts: list[str]) -> list[list[float]]:
        result = self._client.embed(texts, model="voyage-3", input_type="document")
        return result.embeddings

    def embed_query(self, text: str) -> list[float]:
        result = self._client.embed([text], model="voyage-3", input_type="query")
        return result.embeddings[0]


class SBertEmbedder:
    dim = SBERT_DIM

    def __init__(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise ImportError("pip install sentence-transformers")
        logger.info("Loading SentenceTransformer '%s' …", SBERT_MODEL)
        self._model = SentenceTransformer(SBERT_MODEL)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, convert_to_numpy=True).tolist()

    def embed_query(self, text: str) -> list[float]:
        return self._model.encode([text], convert_to_numpy=True)[0].tolist()


def build_embedder(api_key: Optional[str] = None):
    """Return VoyageEmbedder if VOYAGE_API_KEY available, else SBertEmbedder."""
    key = api_key or os.getenv("VOYAGE_API_KEY")
    if key:
        logger.info("Using voyage-3 embedder.")
        return VoyageEmbedder(api_key=key)
    logger.warning("VOYAGE_API_KEY not set — using sentence-transformers fallback.")
    return SBertEmbedder()
