"""
Session store — short-term (Redis, 1h TTL) + long-term (Postgres Memory table).

Short-term: full AgentState serialised to Redis JSON per session_id.
Long-term:  important facts (prorata, client preferences, previous credits)
            stored in a `agent_memory` Postgres table (auto-created).

Both stores degrade gracefully when their backend is unavailable.

PRD reference: §4.3 "Deal Room" — Session memory.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime
from typing import Any, Optional

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 3600   # 1 hour

_CREATE_MEMORY_TABLE = """
CREATE TABLE IF NOT EXISTS agent_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT NOT NULL,
    org_id          TEXT NOT NULL,
    fiscal_client_id TEXT NOT NULL,
    fact_key        TEXT NOT NULL,
    fact_value      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, fact_key)
);
CREATE INDEX IF NOT EXISTS agent_memory_client_idx
    ON agent_memory (org_id, fiscal_client_id);
"""


# ── In-process fallback store (no Redis) ─────────────────────────────────────

class _InMemoryStore:
    """Simple dict-based fallback when Redis is unavailable."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[str, float]] = {}   # key → (json, expires_at)

    def get(self, key: str) -> Optional[str]:
        entry = self._data.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.time() > expires_at:
            del self._data[key]
            return None
        return value

    def set(self, key: str, value: str, ttl: int = SESSION_TTL_SECONDS) -> None:
        self._data[key] = (value, time.time() + ttl)

    def delete(self, key: str) -> None:
        self._data.pop(key, None)


_fallback_store = _InMemoryStore()


# ── Redis client builder ──────────────────────────────────────────────────────

def _get_redis():
    """Return a redis.asyncio.Redis client or None."""
    url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        import redis.asyncio as aioredis
        return aioredis.from_url(url, decode_responses=True)
    except Exception as exc:
        logger.debug("Redis unavailable (%s) — using in-memory store.", exc)
        return None


# ── Short-term store (Redis / in-memory) ──────────────────────────────────────

async def save_session(session_id: str, state: dict) -> None:
    """Serialise and store agent state (TTL 1h)."""
    # Remove non-serialisable fields before storing
    storable = {k: v for k, v in state.items() if k != "audit_pool"}
    payload = json.dumps(storable, default=str)
    key = f"stratus:session:{session_id}"

    redis = _get_redis()
    if redis:
        try:
            await redis.setex(key, SESSION_TTL_SECONDS, payload)
            await redis.aclose()
            return
        except Exception as exc:
            logger.debug("Redis save failed (%s) — using fallback.", exc)

    _fallback_store.set(key, payload)


async def load_session(session_id: str) -> Optional[dict]:
    """Load agent state from store. Returns None if not found / expired."""
    key = f"stratus:session:{session_id}"

    redis = _get_redis()
    if redis:
        try:
            raw = await redis.get(key)
            await redis.aclose()
            if raw:
                return json.loads(raw)
        except Exception as exc:
            logger.debug("Redis load failed (%s) — using fallback.", exc)

    raw = _fallback_store.get(key)
    return json.loads(raw) if raw else None


async def delete_session(session_id: str) -> None:
    """Remove session from store."""
    key = f"stratus:session:{session_id}"
    redis = _get_redis()
    if redis:
        try:
            await redis.delete(key)
            await redis.aclose()
            return
        except Exception:
            pass
    _fallback_store.delete(key)


# ── Long-term memory (Postgres) ───────────────────────────────────────────────

async def persist_memory_fact(
    pool,
    session_id: str,
    org_id: str,
    fiscal_client_id: str,
    fact_key: str,
    fact_value: str,
) -> None:
    """
    Upsert a long-term memory fact to Postgres.

    Examples:
      fact_key="prorata_tva", fact_value="73"
      fact_key="credit_anterieur_2025_01", fact_value="1250.00"
      fact_key="regime_tva", fact_value="réel normal mensuel"
    """
    try:
        await pool.execute(_CREATE_MEMORY_TABLE)
        await pool.execute(
            """
            INSERT INTO agent_memory
              (session_id, org_id, fiscal_client_id, fact_key, fact_value)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (session_id, fact_key)
            DO UPDATE SET fact_value = EXCLUDED.fact_value
            """,
            session_id, org_id, fiscal_client_id, fact_key, fact_value,
        )
        logger.debug("Memory fact persisted: %s=%s", fact_key, fact_value)
    except Exception as exc:
        logger.warning("persist_memory_fact failed (non-fatal): %s", exc)


async def load_memory_facts(
    pool,
    org_id: str,
    fiscal_client_id: str,
    limit: int = 50,
) -> dict[str, str]:
    """
    Load the most recent long-term memory facts for a fiscal client.

    Returns: { fact_key: fact_value }
    """
    try:
        await pool.execute(_CREATE_MEMORY_TABLE)
        rows = await pool.fetch(
            """
            SELECT DISTINCT ON (fact_key)
                fact_key, fact_value
            FROM agent_memory
            WHERE org_id = $1 AND fiscal_client_id = $2
            ORDER BY fact_key, created_at DESC
            LIMIT $3
            """,
            org_id, fiscal_client_id, limit,
        )
        return {row["fact_key"]: row["fact_value"] for row in rows}
    except Exception as exc:
        logger.warning("load_memory_facts failed (non-fatal): %s", exc)
        return {}
