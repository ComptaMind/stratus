"""
LLMGateway — multi-model router with PII scrubbing, tracing, and fallback.

Routing logic
-------------
  model_hint='classify'    → Claude Haiku 4.5  (cheap, high-throughput)
  model_hint='reason'      → Claude Sonnet 4.6 (default)
  model_hint='reason_hard' → Claude Opus 4.6   (complex reasoning)
  model_hint=None/unknown  → Claude Sonnet 4.6

Fallback
--------
  Any Anthropic APITimeoutError or APIConnectionError triggers an automatic
  cascade to Mistral Large 3.  All other Anthropic errors are re-raised.

PRD references: §3.2 "Determinism-first / Multi-LLM routing", §4.1 "Brain".
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import anthropic

from .models import (
    ANTHROPIC_MODEL_HINTS,
    DEFAULT_ANTHROPIC_MODEL,
    MISTRAL_FALLBACK_MODEL,
    LLMResponse,
)
from .pii_scrubber import PIIScrubber
from .tracing import LLMTracer

logger = logging.getLogger(__name__)


class LLMGateway:
    """
    Central LLM gateway for the Stratus agent.

    Parameters
    ----------
    anthropic_api_key : str, optional
        Falls back to ANTHROPIC_API_KEY env var via the SDK default.
    mistral_api_key : str, optional
        Falls back to MISTRAL_API_KEY env var via the SDK default.
    scrubber : PIIScrubber, optional
        Defaults to an in-process (no-Redis) scrubber.
    tracer : LLMTracer, optional
        Defaults to a no-DB tracer (logs to stdout only).
    anthropic_timeout : float
        Per-request timeout in seconds for Anthropic calls.
    """

    def __init__(
        self,
        anthropic_api_key: Optional[str] = None,
        mistral_api_key: Optional[str] = None,
        scrubber: Optional[PIIScrubber] = None,
        tracer: Optional[LLMTracer] = None,
        anthropic_timeout: float = 30.0,
    ) -> None:
        self._anthropic = anthropic.AsyncAnthropic(
            api_key=anthropic_api_key,
            timeout=anthropic_timeout,
        )
        from mistralai.client import Mistral
        self._mistral = Mistral(api_key=mistral_api_key or "placeholder")
        self._scrubber = scrubber or PIIScrubber()
        self._tracer = tracer or LLMTracer()

    # ── Public API ────────────────────────────────────────────────────────────

    async def complete(
        self,
        prompt: str,
        system: str = "",
        tools: Optional[list] = None,
        model_hint: Optional[str] = None,
        session_id: str = "default",
        organization_id: Optional[str] = None,
    ) -> LLMResponse:
        """
        Send a prompt to the appropriate LLM and return a structured response.

        PII is scrubbed from prompt + system before transmission.
        The call is traced asynchronously to llm_calls.
        """
        # 1 — PII scrub
        prompt_clean, _ = await self._scrubber.scrub(prompt, session_id)
        system_clean, _ = await self._scrubber.scrub(system, session_id)

        # 2 — Model selection
        model = ANTHROPIC_MODEL_HINTS.get(model_hint or "", DEFAULT_ANTHROPIC_MODEL)

        # 3 — LLM call (with fallback)
        t0 = time.monotonic()
        fallback_used = False
        trace_error: Optional[str] = None

        try:
            raw = await self._call_anthropic(prompt_clean, system_clean, model, tools)
        except (anthropic.APITimeoutError, anthropic.APIConnectionError) as exc:
            logger.warning(
                "Anthropic %s — cascading to Mistral Large: %s",
                type(exc).__name__, exc,
            )
            fallback_used = True
            trace_error = f"{type(exc).__name__}: {exc}"
            raw = await self._call_mistral(prompt_clean, system_clean)
            model = MISTRAL_FALLBACK_MODEL

        latency_ms = int((time.monotonic() - t0) * 1000)

        # 4 — Async trace (non-fatal)
        await self._tracer.log(
            prompt=prompt_clean,
            system=system_clean,
            model=raw.model_used,
            input_tokens=raw.input_tokens,
            output_tokens=raw.output_tokens,
            latency_ms=latency_ms,
            error=trace_error,
            organization_id=organization_id,
        )

        return LLMResponse(
            content=raw.content,
            model_used=raw.model_used,
            input_tokens=raw.input_tokens,
            output_tokens=raw.output_tokens,
            latency_ms=latency_ms,
            fallback_used=fallback_used,
        )

    # ── Internal call helpers (thin wrappers — easy to mock in tests) ─────────

    async def _call_anthropic(
        self,
        prompt: str,
        system: str,
        model: str,
        tools: Optional[list],
    ) -> LLMResponse:
        kwargs: dict = {
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = tools

        msg = await self._anthropic.messages.create(**kwargs)

        content = "".join(
            block.text for block in msg.content if hasattr(block, "text")
        )
        return LLMResponse(
            content=content,
            model_used=msg.model,
            input_tokens=msg.usage.input_tokens,
            output_tokens=msg.usage.output_tokens,
            latency_ms=0,
            fallback_used=False,
        )

    async def _call_mistral(self, prompt: str, system: str) -> LLMResponse:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        resp = await self._mistral.chat.complete_async(
            model=MISTRAL_FALLBACK_MODEL,
            messages=messages,
        )

        choice = resp.choices[0]
        return LLMResponse(
            content=choice.message.content or "",
            model_used=MISTRAL_FALLBACK_MODEL,
            input_tokens=resp.usage.prompt_tokens,
            output_tokens=resp.usage.completion_tokens,
            latency_ms=0,
            fallback_used=True,
        )
