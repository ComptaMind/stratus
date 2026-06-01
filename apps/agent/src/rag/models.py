"""Shared data models for the RAG layer."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Chunk:
    """A retrieved text chunk with provenance metadata."""
    text: str
    url: str
    title: str
    section_path: str
    last_updated: str
    score: float = 0.0
    bofip_id: str = ""
    chunk_index: int = 0


@dataclass
class RetrievalResult:
    """Full retrieval result for one query."""
    query: str
    chunks: list[Chunk]
    latency_ms: int
    dense_hits: int = 0
    sparse_hits: int = 0
