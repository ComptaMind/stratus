"""
BOFiPRetriever — hybrid dense + sparse retrieval for BOFiP-TVA.

Retrieval pipeline
------------------
1. Dense retrieval  : embed query with voyage-3 → Qdrant ANN search.
2. Sparse retrieval : BM25 over in-memory corpus (pre-loaded from Qdrant payloads).
3. Fusion           : Reciprocal Rank Fusion (RRF, k=60) over the two ranked lists.
4. Return           : top-k Chunk objects with fused score and provenance metadata.

Provenance tracking
-------------------
Every call to `retrieve()` logs an AuditEvent (asyncpg) if a pool is provided:
  { query, retrieved_chunks: [{url, title, score}], retrieval_latency_ms }

PRD reference: §4.1 "Brain — RAG layer".
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

COLLECTION_NAME = "bofip_tva_fr"
RRF_K = 60  # standard RRF constant


class BOFiPRetriever:
    """
    Hybrid BOFiP TVA retriever.

    Parameters
    ----------
    qdrant_client : QdrantClient
        Pre-configured Qdrant client.
    embedder :
        Any object with `.embed_query(text) -> list[float]`.
    corpus_chunks : list[dict]
        Pre-loaded Qdrant payloads (text, url, title, section_path, last_updated).
        Used to build the in-memory BM25 index.
    db_pool : asyncpg.Pool, optional
        Postgres pool for audit event logging (omit in tests/dev).
    collection_name : str
        Qdrant collection name.
    """

    def __init__(
        self,
        qdrant_client,
        embedder,
        corpus_chunks: list[dict],
        db_pool=None,
        collection_name: str = COLLECTION_NAME,
    ) -> None:
        from .bm25_index import BM25Index
        from .models import Chunk

        self._qdrant = qdrant_client
        self._embedder = embedder
        self._corpus = corpus_chunks
        self._corpus_texts = [c["text"] for c in corpus_chunks]
        self._bm25 = BM25Index(self._corpus_texts)
        self._pool = db_pool
        self._collection = collection_name
        self._Chunk = Chunk

        logger.info(
            "BOFiPRetriever ready: %d chunks in BM25 index, collection='%s'.",
            len(corpus_chunks), collection_name,
        )

    # ── Factory ──────────────────────────────────────────────────────────────

    @classmethod
    def from_qdrant(
        cls,
        qdrant_url: Optional[str] = None,
        qdrant_api_key: Optional[str] = None,
        voyage_api_key: Optional[str] = None,
        db_pool=None,
        collection_name: str = COLLECTION_NAME,
        scroll_limit: int = 5000,
    ) -> "BOFiPRetriever":
        """
        Build a retriever by connecting to Qdrant and loading all stored chunks.
        Uses voyage-3 embedder if VOYAGE_API_KEY is available, else SBert fallback.
        """
        from qdrant_client import QdrantClient
        from .embedder import build_embedder

        url = qdrant_url or os.getenv("QDRANT_URL", "http://localhost:6333")
        api_key = qdrant_api_key or os.getenv("QDRANT_API_KEY")

        client = QdrantClient(url=url, api_key=api_key, timeout=30)
        embedder = build_embedder(voyage_api_key)

        # Scroll all payloads for BM25 corpus
        all_payloads = []
        offset = None
        while True:
            results, next_offset = client.scroll(
                collection_name=collection_name,
                limit=scroll_limit,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )
            all_payloads.extend([r.payload for r in results if r.payload])
            if next_offset is None:
                break
            offset = next_offset

        logger.info("Loaded %d chunks from Qdrant for BM25 corpus.", len(all_payloads))
        return cls(client, embedder, all_payloads, db_pool, collection_name)

    # ── Public API ────────────────────────────────────────────────────────────

    def retrieve(
        self,
        query: str,
        k: int = 5,
        filter_section: Optional[str] = None,
    ) -> list:
        """
        Hybrid retrieve: dense (Qdrant) + sparse (BM25) → RRF fusion.

        Parameters
        ----------
        query : str
        k : int
            Number of results to return.
        filter_section : str, optional
            Filter to chunks whose section_path contains this string.

        Returns
        -------
        list[Chunk]
        """
        t0 = time.monotonic()

        # 1 — Dense retrieval
        dense_results = self._dense_search(query, top_k=k * 4, filter_section=filter_section)

        # 2 — Sparse (BM25) retrieval
        sparse_results = self._sparse_search(query, top_k=k * 4, filter_section=filter_section)

        # 3 — RRF fusion
        fused = self._rrf_fuse(dense_results, sparse_results)

        # 4 — Return top-k as Chunk objects
        chunks = []
        for idx_or_payload, rrf_score, source in fused[:k]:
            if source == "dense":
                payload = idx_or_payload
            else:
                payload = self._corpus[idx_or_payload]

            chunks.append(self._Chunk(
                text=payload.get("text", ""),
                url=payload.get("url", ""),
                title=payload.get("title", ""),
                section_path=payload.get("section_path", ""),
                last_updated=payload.get("last_updated", ""),
                score=rrf_score,
                bofip_id=payload.get("bofip_id", ""),
                chunk_index=payload.get("chunk_index", 0),
            ))

        latency_ms = int((time.monotonic() - t0) * 1000)

        # 5 — Provenance audit (fire-and-forget, non-fatal)
        if self._pool is not None:
            asyncio.create_task(
                self._log_audit(query, chunks, latency_ms)
            )
        else:
            logger.debug(
                "retrieve query='%s' → %d chunks in %dms",
                query[:80], len(chunks), latency_ms,
            )

        return chunks

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _dense_search(
        self, query: str, top_k: int, filter_section: Optional[str]
    ) -> list[tuple[dict, float]]:
        """Query Qdrant ANN and return (payload, score) list."""
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            q_filter = None
            if filter_section:
                q_filter = Filter(
                    must=[FieldCondition(
                        key="section_path",
                        match=MatchValue(value=filter_section),
                    )]
                )
            vector = self._embedder.embed_query(query)
            results = self._qdrant.search(
                collection_name=self._collection,
                query_vector=vector,
                limit=top_k,
                query_filter=q_filter,
                with_payload=True,
            )
            return [(r.payload, r.score) for r in results if r.payload]
        except Exception as exc:
            logger.warning("Dense search failed: %s", exc)
            return []

    def _sparse_search(
        self, query: str, top_k: int, filter_section: Optional[str]
    ) -> list[tuple[int, float]]:
        """BM25 search over in-memory corpus. Returns (corpus_idx, score)."""
        results = self._bm25.query(query, top_k=top_k)
        if filter_section:
            results = [
                (idx, sc) for idx, sc in results
                if filter_section in self._corpus[idx].get("section_path", "")
            ]
        return results

    @staticmethod
    def _rrf_fuse(
        dense: list[tuple[dict, float]],
        sparse: list[tuple[int, float]],
        k: int = RRF_K,
    ) -> list[tuple]:
        """
        Reciprocal Rank Fusion.
        Returns merged list of (payload_or_idx, rrf_score, source) sorted desc.
        """
        rrf: dict[str, dict] = {}

        # Dense: key = url + chunk_index
        for rank, (payload, _) in enumerate(dense):
            key = f"dense|{payload.get('url','')}|{payload.get('chunk_index', 0)}"
            rrf[key] = rrf.get(key, {"score": 0.0, "data": payload, "source": "dense"})
            rrf[key]["score"] += 1.0 / (k + rank + 1)

        # Sparse: key = corpus index
        for rank, (idx, _) in enumerate(sparse):
            key = f"sparse|{idx}"
            if key not in rrf:
                rrf[key] = {"score": 0.0, "data": idx, "source": "sparse"}
            rrf[key]["score"] += 1.0 / (k + rank + 1)

        # Sort by fused score descending
        merged = sorted(rrf.values(), key=lambda x: x["score"], reverse=True)
        return [(item["data"], item["score"], item["source"]) for item in merged]

    async def _log_audit(
        self,
        query: str,
        chunks: list,
        latency_ms: int,
    ) -> None:
        """Write retrieval audit event to Postgres (non-fatal)."""
        try:
            payload = {
                "query": query,
                "retrieved_chunks": [
                    {"url": c.url, "title": c.title, "score": c.score}
                    for c in chunks
                ],
                "retrieval_latency_ms": latency_ms,
            }
            import json
            await self._pool.execute(
                """
                INSERT INTO audit_events
                  (org_id, actor_type, actor_id, action, entity_type, entity_id, payload)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                """,
                "system",
                "system",
                "rag",
                "rag.retrieve",
                "BOFiPRetriever",
                "bofip_tva_fr",
                json.dumps(payload),
            )
        except Exception as exc:
            logger.debug("Audit log failed (non-fatal): %s", exc)
