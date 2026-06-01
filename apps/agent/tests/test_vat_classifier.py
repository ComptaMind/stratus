"""
Tests for VATClassifier — deterministic rules + LLM fallback.

All LLM calls are mocked so no API key is required.

Coverage:
  - RuleEngine: exact match, prefix match, 6xx, 7xx, out-of-scope
  - VATClassifier: deterministic path (no LLM calls), LLM escalation path,
    LLM error handling, ≥80% deterministic hit rate on fixture set
"""
from __future__ import annotations

import json
from typing import Optional
from unittest.mock import AsyncMock

import pytest

from src.classifier.rules import RuleEngine
from src.classifier.vat_classifier import FECEntryInput, VATClassifier
from src.llm.gateway import LLMGateway
from src.llm.models import LLMResponse, DEFAULT_ANTHROPIC_MODEL
from src.llm.pii_scrubber import PIIScrubber

from tests.fixtures.fec_vat_entries import (
    DETERMINISTIC_ENTRIES,
    LLM_ENTRIES,
    ALL_ENTRIES,
    EXPECTED_VAT_TYPES,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_gateway(llm_response_json: Optional[dict] = None) -> LLMGateway:
    """Gateway with mocked _call_anthropic; tracks call count."""
    gw = LLMGateway(
        anthropic_api_key="test-key",
        mistral_api_key="test-key",
        scrubber=PIIScrubber(),
        tracer=None,
    )
    if llm_response_json is not None:
        async def fake_anthropic(prompt, system, model, tools):
            return LLMResponse(
                content=json.dumps(llm_response_json),
                model_used=DEFAULT_ANTHROPIC_MODEL,
                input_tokens=20,
                output_tokens=10,
                latency_ms=0,
                fallback_used=False,
            )
        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
    return gw


def _make_classifier(llm_response_json: Optional[dict] = None) -> VATClassifier:
    """VATClassifier with no-DB (no asyncpg) and optional LLM mock."""
    gw = _make_gateway(llm_response_json)
    return VATClassifier(gateway=gw, dsn=None)


# ── RuleEngine tests ──────────────────────────────────────────────────────────


class TestRuleEngine:
    def setup_method(self):
        self.engine = RuleEngine()

    def test_exact_44564_deductible_20(self):
        assert self.engine.resolve("44564000") == "deductible_20"

    def test_exact_44551_collectee_20(self):
        assert self.engine.resolve("44551000") == "collectee_20"

    def test_exact_44552_collectee_10(self):
        assert self.engine.resolve("44552000") == "collectee_10"

    def test_exact_44566_deductible_55(self):
        assert self.engine.resolve("44566000") == "deductible_55"

    def test_exact_44562_deductible_immo(self):
        assert self.engine.resolve("44562000") == "deductible_immo"

    def test_exact_44563_deductible_intracom(self):
        assert self.engine.resolve("44563000") == "deductible_intracom"

    def test_exact_44571_collectee_20(self):
        assert self.engine.resolve("44571000") == "collectee_20"

    def test_exact_44581_autoliquidation_debit(self):
        assert self.engine.resolve("44581000") == "autoliquidation_debit"

    def test_prefix_4458_regularisation(self):
        assert self.engine.resolve("44580000") == "regularisation"

    def test_prefix_44553_collectee_55(self):
        assert self.engine.resolve("44553001") == "collectee_55"

    def test_6xx_deductible_20(self):
        assert self.engine.resolve("60100000") == "deductible_20"

    def test_6xx_deplacements_deductible_20(self):
        assert self.engine.resolve("62500000") == "deductible_20"

    def test_6xx_interest_hors_champ(self):
        assert self.engine.resolve("66100000") == "hors_champ"

    def test_7xx_services_collectee_20(self):
        assert self.engine.resolve("70600000") == "collectee_20"

    def test_7xx_dividends_hors_champ(self):
        assert self.engine.resolve("75000000") == "hors_champ"

    def test_out_of_scope_401_returns_none(self):
        assert self.engine.resolve("40100000") is None

    def test_out_of_scope_512_returns_none(self):
        assert self.engine.resolve("51200000") is None

    def test_is_in_scope_true_for_44x(self):
        assert self.engine.is_in_scope("44564") is True

    def test_is_in_scope_true_for_6xx(self):
        assert self.engine.is_in_scope("606") is True

    def test_is_in_scope_true_for_7xx(self):
        assert self.engine.is_in_scope("706") is True

    def test_is_in_scope_false_for_401(self):
        assert self.engine.is_in_scope("401") is False


# ── VATClassifier — deterministic path ────────────────────────────────────────


class TestVATClassifierDeterministic:
    async def test_deterministic_entries_no_llm_called(self):
        """Rule-resolved entries must not trigger LLM."""
        llm_calls = []

        gw = _make_gateway()

        async def fake_anthropic(prompt, system, model, tools):
            llm_calls.append(prompt)
            return LLMResponse(
                content='{"vat_type":"ambiguous","confidence":0.5,"reasoning":"test"}',
                model_used=model, input_tokens=10, output_tokens=5,
                latency_ms=0, fallback_used=False,
            )

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        classifier = VATClassifier(gateway=gw, dsn=None)

        results = await classifier.classify(
            entries=DETERMINISTIC_ENTRIES,
            fec_import_id="test-import-det",
        )

        assert len(llm_calls) == 0, (
            f"LLM was called {len(llm_calls)} times for fully deterministic entries"
        )
        assert len(results) == len(DETERMINISTIC_ENTRIES)
        for r in results:
            assert r.method == "rule"

    async def test_deterministic_vat_types_match_expected(self):
        """Each deterministic entry must resolve to the expected VAT type."""
        classifier = _make_classifier()
        results = await classifier.classify(
            entries=DETERMINISTIC_ENTRIES,
            fec_import_id="test-import-types",
        )

        assert len(results) == len(EXPECTED_VAT_TYPES)
        for result, expected in zip(results, EXPECTED_VAT_TYPES):
            assert result.vat_type == expected, (
                f"Entry {result.ecriture_num} ({result.compte_num}): "
                f"expected {expected!r}, got {result.vat_type!r}"
            )

    async def test_deterministic_confidence_is_1(self):
        classifier = _make_classifier()
        results = await classifier.classify(
            entries=DETERMINISTIC_ENTRIES,
            fec_import_id="test-import-conf",
        )
        for r in results:
            assert r.confidence == 1.0

    async def test_out_of_scope_entries_skipped(self):
        """Accounts 4xx (non-44x), 5xx should be silently skipped."""
        out_of_scope = [
            FECEntryInput("X001", "40100000", "Fournisseur", "Facture fournisseur", 1000.0, 0.0),
            FECEntryInput("X002", "51200000", "Banque", "Virement", 0.0, 1000.0),
        ]
        classifier = _make_classifier()
        results = await classifier.classify(
            entries=out_of_scope,
            fec_import_id="test-import-oos",
        )
        assert results == []


# ── VATClassifier — LLM escalation ────────────────────────────────────────────


class TestVATClassifierLLM:
    async def test_ambiguous_entry_triggers_llm(self):
        """Account 64700000 (autres charges sociales) is not in any rule set — must escalate."""
        llm_calls = []

        gw = _make_gateway()

        async def fake_anthropic(prompt, system, model, tools):
            llm_calls.append(prompt)
            return LLMResponse(
                content='{"vat_type":"hors_champ","confidence":0.9,"reasoning":"Charges sociales hors TVA"}',
                model_used=model, input_tokens=10, output_tokens=8,
                latency_ms=0, fallback_used=False,
            )

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        classifier = VATClassifier(gateway=gw, dsn=None)

        # B003 = compte 64700000 — not covered by any rule set → LLM needed
        results = await classifier.classify(
            entries=[LLM_ENTRIES[2]],
            fec_import_id="test-import-llm",
        )

        assert len(llm_calls) == 1
        assert results[0].method == "llm"
        assert results[0].vat_type == "hors_champ"
        assert results[0].confidence == pytest.approx(0.9)

    async def test_llm_error_returns_ambiguous(self):
        """If LLM call fails, result should be ambiguous with error set."""
        gw = _make_gateway()

        async def failing_anthropic(prompt, system, model, tools):
            raise RuntimeError("LLM unavailable")

        gw._call_anthropic = failing_anthropic  # type: ignore[method-assign]
        classifier = VATClassifier(gateway=gw, dsn=None)

        # B003 = compte 64700000 — not covered by rules → will hit LLM → will fail
        results = await classifier.classify(
            entries=[LLM_ENTRIES[2]],
            fec_import_id="test-import-err",
        )

        assert results[0].vat_type == "ambiguous"
        assert results[0].confidence == 0.0
        assert results[0].error is not None

    async def test_llm_reasoning_stored(self):
        """llm_reasoning field must be populated from LLM response."""
        gw = _make_gateway(
            llm_response_json={
                "vat_type": "hors_champ",
                "confidence": 0.9,
                "reasoning": "Charges sociales hors champ TVA",
            }
        )
        classifier = VATClassifier(gateway=gw, dsn=None)

        results = await classifier.classify(
            entries=[LLM_ENTRIES[2]],  # B003 64700000
            fec_import_id="test-import-reasoning",
        )

        assert results[0].llm_reasoning == "Charges sociales hors champ TVA"


# ── Hit-rate test ─────────────────────────────────────────────────────────────


class TestDeterministicHitRate:
    async def test_at_least_80_percent_deterministic(self):
        """
        Over the full 20-entry fixture, at least 80% must be resolved by rules.
        (16 deterministic / 20 total = 80.0%)
        """
        llm_calls = []

        gw = _make_gateway()

        async def fake_anthropic(prompt, system, model, tools):
            llm_calls.append(prompt)
            return LLMResponse(
                content='{"vat_type":"ambiguous","confidence":0.5,"reasoning":"LLM fallback"}',
                model_used=model, input_tokens=10, output_tokens=5,
                latency_ms=0, fallback_used=False,
            )

        gw._call_anthropic = fake_anthropic  # type: ignore[method-assign]
        classifier = VATClassifier(gateway=gw, dsn=None)

        results = await classifier.classify(
            entries=ALL_ENTRIES,
            fec_import_id="test-import-hitrate",
        )

        rule_results = [r for r in results if r.method == "rule"]
        hit_rate = len(rule_results) / len(results)

        assert hit_rate >= 0.80, (
            f"Deterministic hit rate {hit_rate:.1%} < 80% "
            f"({len(rule_results)}/{len(results)} rule-resolved)"
        )
