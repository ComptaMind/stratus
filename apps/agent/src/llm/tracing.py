"""
LLM call tracing — writes to the llm_calls Postgres table.

The table is auto-created on first connection (CREATE TABLE IF NOT EXISTS)
so no separate migration is required for the agent service.

Tracing is non-fatal: any DB error is logged and silently swallowed so it
never crashes the main request.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Optional

import asyncpg

from .models import compute_cost_eur

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS llm_calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_hash     CHAR(64)  NOT NULL,
    system_hash     CHAR(64)  NOT NULL,
    model           TEXT      NOT NULL,
    tokens_input    INTEGER   NOT NULL DEFAULT 0,
    tokens_output   INTEGER   NOT NULL DEFAULT 0,
    cost_eur        NUMERIC(12,6) NOT NULL DEFAULT 0,
    latency_ms      INTEGER   NOT NULL DEFAULT 0,
    error           TEXT,
    organization_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS llm_calls_org_idx ON llm_calls (organization_id);
CREATE INDEX IF NOT EXISTS llm_calls_model_idx ON llm_calls (model);
"""


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class LLMTracer:
    """
    Async Postgres tracer for LLM calls.

    Parameters
    ----------
    dsn : optional str
        Postgres DSN (DATABASE_URL).  When absent, tracing is skipped and
        metrics are only emitted to the logger (useful in tests / local dev).
    """

    def __init__(self, dsn: Optional[str] = None) -> None:
        self._dsn = dsn
        self._pool: Optional[asyncpg.Pool] = None

    async def _ensure_pool(self) -> Optional[asyncpg.Pool]:
        if not self._dsn:
            return None
        if self._pool is None:
            try:
                self._pool = await asyncpg.create_pool(self._dsn)
                await self._pool.execute(_CREATE_TABLE_SQL)
            except Exception as exc:
                logger.error("LLMTracer: failed to create pool: %s", exc)
                self._pool = None
        return self._pool

    async def log(
        self,
        *,
        prompt: str,
        system: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        latency_ms: int,
        error: Optional[str] = None,
        organization_id: Optional[str] = None,
    ) -> None:
        cost = compute_cost_eur(model, input_tokens, output_tokens)

        pool = await self._ensure_pool()
        if pool is None:
            logger.debug(
                "llm_call model=%s in=%d out=%d cost_eur=%.4f latency=%dms error=%s",
                model, input_tokens, output_tokens, cost, latency_ms, error,
            )
            return

        try:
            await pool.execute(
                """
                INSERT INTO llm_calls
                  (prompt_hash, system_hash, model, tokens_input, tokens_output,
                   cost_eur, latency_ms, error, organization_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                _sha256(prompt),
                _sha256(system),
                model,
                input_tokens,
                output_tokens,
                cost,
                latency_ms,
                error,
                organization_id,
            )
        except Exception as exc:
            logger.error("LLMTracer: DB write failed: %s", exc)
