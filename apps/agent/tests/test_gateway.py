"""
Tests for LLMGateway.

All external calls (Anthropic, Mistral) are mocked so no real API keys
or network access are required.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import pytest

from src.llm.gateway import LLMGateway
from src.llm.models import (
    ANTHROPIC_MODEL_HINTS,
    DEFAULT_ANTHROPIC_MODEL,
    MISTRAL_FALLBACK_MODEL,
    LLMResponse,
    compute_cost_eur,
)
from src.llm.pii_scrubber import PIIScrubber


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_anthropic_response(model: str, content: str = "ok") -> MagicMock:
    """Build a fake anthropic.types.Message."""
    msg = MagicMock()
    msg.model = model
    msg.content = [MagicMock(text=content)]
    msg.usage = MagicMock(input_tokens=10, output_tokens=5)
    return msg


def _make_mistral_response(content: str = "fallback ok") -> MagicMock:
    """Build a fake mistralai ChatCompletion."""
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message.content = content
    resp.usage = MagicMock(prompt_tokens=8, completion_tokens=4)
    return resp


def _gateway(anthropic_mock_create=None, mistral_mock_create=None) -> LLMGateway:
    """
    Return a LLMGateway whose underlying SDK calls are replaced with mocks.
    We patch _call_anthropic / _call_mistral directly — simpler and more
    robust than patching deep SDK internals.
    """
    gw = LLMGateway(
        anthropic_api_key="test-key",
        mistral_api_key="test-key",
        scrubber=PIIScrubber(),   # in-memory, no Redis
        tracer=None,               # no-DB tracer
    )
    return gw


# ── Model routing ─────────────────────────────────────────────────────────────

class TestModelRouting:
    async def test_classify_hint_uses_haiku(self) -> None:
        gw = _gateway()
        captured: dict = {}

        async def fake_anthropic(prompt, system, model, tools):
            captured["model"] = model
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        await gw.complete("test", model_hint="classify")
        assert captured["model"] == ANTHROPIC_MODEL_HINTS["classify"]

    async def test_reason_hint_uses_sonnet(self) -> None:
        gw = _gateway()
        captured: dict = {}

        async def fake_anthropic(prompt, system, model, tools):
            captured["model"] = model
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        await gw.complete("test", model_hint="reason")
        assert captured["model"] == ANTHROPIC_MODEL_HINTS["reason"]

    async def test_reason_hard_hint_uses_opus(self) -> None:
        gw = _gateway()
        captured: dict = {}

        async def fake_anthropic(prompt, system, model, tools):
            captured["model"] = model
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        await gw.complete("test", model_hint="reason_hard")
        assert captured["model"] == ANTHROPIC_MODEL_HINTS["reason_hard"]

    async def test_no_hint_uses_default_sonnet(self) -> None:
        gw = _gateway()
        captured: dict = {}

        async def fake_anthropic(prompt, system, model, tools):
            captured["model"] = model
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        await gw.complete("test")
        assert captured["model"] == DEFAULT_ANTHROPIC_MODEL

    async def test_unknown_hint_uses_default(self) -> None:
        gw = _gateway()
        captured: dict = {}

        async def fake_anthropic(prompt, system, model, tools):
            captured["model"] = model
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        await gw.complete("test", model_hint="nonexistent")
        assert captured["model"] == DEFAULT_ANTHROPIC_MODEL


# ── Fallback behaviour ────────────────────────────────────────────────────────

class TestFallback:
    async def test_timeout_triggers_mistral_fallback(self) -> None:
        gw = _gateway()
        mistral_called: dict = {}

        async def raise_timeout(prompt, system, model, tools):
            raise anthropic.APITimeoutError(request=MagicMock())

        async def fake_mistral(prompt, system):
            mistral_called["called"] = True
            return LLMResponse(content="mistral response",
                               model_used=MISTRAL_FALLBACK_MODEL,
                               input_tokens=8, output_tokens=4,
                               latency_ms=0, fallback_used=True)

        gw._call_anthropic = raise_timeout   # type: ignore[method-assign]
        gw._call_mistral = fake_mistral       # type: ignore[method-assign]

        result = await gw.complete("test")

        assert mistral_called.get("called") is True
        assert result.fallback_used is True
        assert result.model_used == MISTRAL_FALLBACK_MODEL

    async def test_connection_error_triggers_mistral_fallback(self) -> None:
        gw = _gateway()
        mistral_called: dict = {}

        async def raise_conn(prompt, system, model, tools):
            raise anthropic.APIConnectionError(request=MagicMock(), message="conn err")

        async def fake_mistral(prompt, system):
            mistral_called["called"] = True
            return LLMResponse(content="mistral ok",
                               model_used=MISTRAL_FALLBACK_MODEL,
                               input_tokens=8, output_tokens=4,
                               latency_ms=0, fallback_used=True)

        gw._call_anthropic = raise_conn    # type: ignore[method-assign]
        gw._call_mistral = fake_mistral    # type: ignore[method-assign]

        result = await gw.complete("test")
        assert mistral_called.get("called") is True
        assert result.fallback_used is True

    async def test_non_timeout_error_is_not_caught(self) -> None:
        """Rate limit errors should bubble up, not trigger Mistral fallback."""
        gw = _gateway()

        async def raise_ratelimit(prompt, system, model, tools):
            raise anthropic.RateLimitError(
                message="rate limited",
                response=MagicMock(status_code=429),
                body={},
            )

        gw._call_anthropic = raise_ratelimit  # type: ignore[method-assign]

        with pytest.raises(anthropic.RateLimitError):
            await gw.complete("test")

    async def test_successful_call_has_fallback_false(self) -> None:
        gw = _gateway()

        async def fake_anthropic(prompt, system, model, tools):
            return LLMResponse(content="fine", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        result = await gw.complete("test")
        assert result.fallback_used is False


# ── PII scrubbing ─────────────────────────────────────────────────────────────

class TestPIIScrubbing:
    async def test_siren_is_scrubbed_before_llm_call(self) -> None:
        gw = _gateway()
        received_prompt: dict = {}

        async def capture_anthropic(prompt, system, model, tools):
            received_prompt["prompt"] = prompt
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = capture_anthropic  # type: ignore[method-assign]

        await gw.complete("Le SIREN est 123 456 789 selon le Kbis.")

        sent = received_prompt["prompt"]
        assert "123 456 789" not in sent, "SIREN must not appear in prompt"
        assert "SIREN-PSEUDO-" in sent, "Pseudo-ID must replace the SIREN"

    async def test_siret_is_scrubbed_before_siren(self) -> None:
        gw = _gateway()
        received_prompt: dict = {}

        async def capture(prompt, system, model, tools):
            received_prompt["prompt"] = prompt
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = capture  # type: ignore[method-assign]

        # SIRET = 14 digits (9 SIREN + 5 NIC)
        await gw.complete("SIRET: 123 456 789 00012")

        sent = received_prompt["prompt"]
        assert "123 456 789 00012" not in sent
        assert "SIRET-PSEUDO-" in sent
        # The SIREN-only pseudo must NOT appear for a matched SIRET
        assert sent.count("PSEUDO-") == 1

    async def test_person_name_is_scrubbed(self) -> None:
        gw = _gateway()
        received_prompt: dict = {}

        async def capture(prompt, system, model, tools):
            received_prompt["prompt"] = prompt
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = capture  # type: ignore[method-assign]

        await gw.complete("Gérant: M. Dupont est responsable.")

        sent = received_prompt["prompt"]
        assert "Dupont" not in sent
        assert "PERSON-PSEUDO-" in sent

    async def test_same_siren_gets_same_pseudo_in_session(self) -> None:
        """Same SIREN within same session must map to the same pseudo-ID."""
        gw = _gateway()
        prompts: list = []

        async def capture(prompt, system, model, tools):
            prompts.append(prompt)
            return LLMResponse(content="ok", model_used=model,
                               input_tokens=10, output_tokens=5,
                               latency_ms=0, fallback_used=False)

        gw._call_anthropic = capture  # type: ignore[method-assign]

        sid = "test-session-42"
        await gw.complete("SIREN 123 456 789", session_id=sid)
        await gw.complete("SIREN 123 456 789 encore", session_id=sid)

        pseudo_1 = [w for w in prompts[0].split() if "PSEUDO" in w][0]
        pseudo_2 = [w for w in prompts[1].split() if "PSEUDO" in w][0]
        assert pseudo_1 == pseudo_2


# ── Cost computation ──────────────────────────────────────────────────────────

class TestCostComputation:
    def test_sonnet_cost(self) -> None:
        # 1000 input + 500 output tokens with Sonnet ($3/$15 per 1M)
        cost = compute_cost_eur("claude-sonnet-4-6", 1000, 500)
        # USD = (1000 * 3 + 500 * 15) / 1_000_000 = (3000 + 7500) / 1e6 = 0.0105
        # EUR = 0.0105 * 0.92 = 0.00966
        assert abs(cost - 0.009660) < 1e-5

    def test_haiku_cost(self) -> None:
        cost = compute_cost_eur("claude-haiku-4-5-20251001", 1000, 500)
        # USD = (1000*0.25 + 500*1.25)/1e6 = (250+625)/1e6 = 0.000875
        # EUR = 0.000875 * 0.92 = 0.000805
        assert abs(cost - 0.000805) < 1e-5

    def test_unknown_model_uses_sonnet_pricing(self) -> None:
        cost = compute_cost_eur("unknown-model", 1000, 1000)
        expected = compute_cost_eur("claude-sonnet-4-6", 1000, 1000)
        assert cost == expected
