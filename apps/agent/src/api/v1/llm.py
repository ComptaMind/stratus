"""
POST /v1/llm/complete — internal LLM gateway endpoint.

This endpoint is NOT meant for external clients; it is used by other agent
modules (FEC classifier, CA3 reasoner, etc.) running in the same service mesh.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ...llm.gateway import LLMGateway
from ...llm.models import LLMCompleteRequest, LLMResponse
from ...llm.pii_scrubber import PIIScrubber
from ...llm.tracing import LLMTracer

router = APIRouter(prefix="/v1/llm", tags=["llm"])

# ── Singleton instances (created once at import time) ─────────────────────────

_scrubber: Optional[PIIScrubber] = None
_tracer: Optional[LLMTracer] = None
_gateway: Optional[LLMGateway] = None


def _get_gateway() -> LLMGateway:
    global _scrubber, _tracer, _gateway
    if _gateway is None:
        redis_url = os.getenv("REDIS_URL")
        redis_client = None
        if redis_url:
            import redis.asyncio as aioredis
            redis_client = aioredis.from_url(redis_url, decode_responses=True)

        _scrubber = PIIScrubber(redis_client=redis_client)
        _tracer = LLMTracer(dsn=os.getenv("DATABASE_URL"))
        _gateway = LLMGateway(
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            mistral_api_key=os.getenv("MISTRAL_API_KEY"),
            scrubber=_scrubber,
            tracer=_tracer,
        )
    return _gateway


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.post("/complete", response_model=LLMResponse, summary="LLM gateway complete")
async def llm_complete(
    body: LLMCompleteRequest,
    gateway: LLMGateway = Depends(_get_gateway),
) -> LLMResponse:
    """
    Route a completion request to the appropriate LLM model.

    - `model_hint='classify'` → Claude Haiku 4.5
    - `model_hint='reason'` → Claude Sonnet 4.6 (default)
    - `model_hint='reason_hard'` → Claude Opus 4.6
    - On Anthropic timeout/connection error → automatic fallback to Mistral Large 3

    PII (SIREN, SIRET, person names) is scrubbed before transmission.
    Every call is traced to the `llm_calls` table.
    """
    try:
        return await gateway.complete(
            prompt=body.prompt,
            system=body.system,
            tools=body.tools,
            model_hint=body.model_hint,
            session_id=body.session_id,
            organization_id=body.organization_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
