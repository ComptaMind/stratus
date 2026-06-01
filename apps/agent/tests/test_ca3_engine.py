"""
Tests for CA3 Engine — deterministic TVA declaration computation.

Three synthetic FEC cases with pre-classified entries.
Every CA3 line is asserted to the cent (Decimal equality, no floating-point).

Case 1: Simple SMB — taux normal 20% only, TVA due
Case 2: Mixed taux (20% + 10% + 5.5%), TVA due, no immo
Case 3: Crédit TVA (déductibles > collectée), remboursement triggered

PRD reference: §4.4 "Declaration Engine".
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from src.declarations.ca3_engine import (
    CA3Declaration,
    ClassifiedEntry,
    ValidationIssue,
    compute_ca3,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

PERIOD_START = date(2025, 1, 1)
PERIOD_END   = date(2025, 1, 31)
CLIENT_ID    = "client-test-001"
ORG_ID       = "org-test-001"


def D(s: str) -> Decimal:
    """Shorthand: Decimal from string, 2dp."""
    return Decimal(s)


def _run(
    entries: list[ClassifiedEntry],
    period_type: str = "mensuelle",
    credit_anterieur: str = "0",
) -> CA3Declaration:
    return compute_ca3(
        fiscal_client_id=CLIENT_ID,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        period_type=period_type,  # type: ignore[arg-type]
        classified_entries=entries,
        credit_tva_anterieur=Decimal(credit_anterieur),
        org_id=ORG_ID,
    )


def issue_codes(decl: CA3Declaration) -> set[str]:
    return {i.code for i in decl.validation_issues}


# ── Case 1: Simple SMB, 20% only, TVA due ────────────────────────────────────
#
#  Input:
#    collectee_20   base=10 000, TVA=2 000
#    deductible_20  base= 5 000, TVA=1 000
#    credit_ant=0
#
#  Expected:
#    L08=10 000  L16=2 000
#    L15=2 000   L20=1 000   L22=1 000
#    L23=0       L24=1 000   L25=0
#    no remboursement, no warnings

CASE1_ENTRIES = [
    ClassifiedEntry("collectee_20",  base_ht=D("10000.00"), tva_amount=D("2000.00")),
    ClassifiedEntry("deductible_20", base_ht=D("5000.00"),  tva_amount=D("1000.00")),
]


class TestCase1SimpleSMB:
    def setup_method(self):
        self.decl = _run(CASE1_ENTRIES)
        self.l = self.decl.lines

    # Cadre A
    def test_A1_equals_base_ventes_20(self):
        assert self.l.A1 == D("10000.00"), f"A1={self.l.A1}"

    def test_A2_zero_no_reduced_rates(self):
        assert self.l.A2 == D("0.00"), f"A2={self.l.A2}"

    # Cadre B bases
    def test_L08_base_20pct(self):
        assert self.l.L08 == D("10000.00"), f"L08={self.l.L08}"

    def test_L09_zero(self):
        assert self.l.L09 == D("0.00")

    def test_L09B_zero(self):
        assert self.l.L09B == D("0.00")

    def test_L10_zero(self):
        assert self.l.L10 == D("0.00")

    # TVA collectée
    def test_L16_tva_20pct(self):
        assert self.l.L16 == D("2000.00"), f"L16={self.l.L16}"

    def test_L17_zero(self):
        assert self.l.L17 == D("0.00")

    def test_L17B_zero(self):
        assert self.l.L17B == D("0.00")

    def test_L18_zero(self):
        assert self.l.L18 == D("0.00")

    def test_L15_total_collectee(self):
        assert self.l.L15 == D("2000.00"), f"L15={self.l.L15}"

    # TVA déductible
    def test_L19_zero_no_immo(self):
        assert self.l.L19 == D("0.00")

    def test_L20_tva_deductible_autres(self):
        assert self.l.L20 == D("1000.00"), f"L20={self.l.L20}"

    def test_L22_total_deductible(self):
        assert self.l.L22 == D("1000.00"), f"L22={self.l.L22}"

    # Solde
    def test_L23_zero_no_credit_anterieur(self):
        assert self.l.L23 == D("0.00")

    def test_L24_tva_due_1000(self):
        assert self.l.L24 == D("1000.00"), f"L24={self.l.L24}"

    def test_L25_zero_no_credit(self):
        assert self.l.L25 == D("0.00"), f"L25={self.l.L25}"

    # Remboursement
    def test_no_refund_requested(self):
        assert self.l.remboursement_demande is False

    # Validation
    def test_no_hard_errors(self):
        assert not self.decl.has_errors, self.decl.validation_issues

    def test_no_high_deductible_warning(self):
        # ratio = 1000/2000 = 50% < 80%
        assert "high_deductible_ratio" not in issue_codes(self.decl)

    def test_entries_count(self):
        assert self.decl.entries_count == 2

    def test_ambiguous_count_zero(self):
        assert self.decl.ambiguous_count == 0


# ── Case 2: Mixed taux (20% + 10% + 5.5%), TVA due ───────────────────────────
#
#  Input:
#    collectee_20   base= 8 000, TVA=1 600
#    collectee_10   base= 2 000, TVA=  200
#    collectee_55   base= 1 000, TVA=   55
#    deductible_20  base= 2 000, TVA=  400
#    credit_ant=0
#
#  Expected:
#    L08=8 000 L09B=2 000 L09=1 000
#    L16=1 600 L17B=200   L17=55
#    L15=1 855
#    L20=400   L22=400
#    L24=1 455  L25=0
#    A1=8 000  A2=3 000
#    ratio=400/1855=21.6% → no high_deductible_ratio warning

CASE2_ENTRIES = [
    ClassifiedEntry("collectee_20",  base_ht=D("8000.00"), tva_amount=D("1600.00")),
    ClassifiedEntry("collectee_10",  base_ht=D("2000.00"), tva_amount=D("200.00")),
    ClassifiedEntry("collectee_55",  base_ht=D("1000.00"), tva_amount=D("55.00")),
    ClassifiedEntry("deductible_20", base_ht=D("2000.00"), tva_amount=D("400.00")),
]


class TestCase2MixedTaux:
    def setup_method(self):
        self.decl = _run(CASE2_ENTRIES)
        self.l = self.decl.lines

    # Cadre A
    def test_A1_base_20pct(self):
        assert self.l.A1 == D("8000.00"), f"A1={self.l.A1}"

    def test_A2_sum_reduced_rates(self):
        # 10% + 5.5% bases
        assert self.l.A2 == D("3000.00"), f"A2={self.l.A2}"

    # Bases HT
    def test_L08(self):
        assert self.l.L08 == D("8000.00")

    def test_L09(self):
        assert self.l.L09 == D("1000.00"), f"L09={self.l.L09}"

    def test_L09B(self):
        assert self.l.L09B == D("2000.00"), f"L09B={self.l.L09B}"

    # TVA collectée
    def test_L16(self):
        assert self.l.L16 == D("1600.00"), f"L16={self.l.L16}"

    def test_L17(self):
        assert self.l.L17 == D("55.00"), f"L17={self.l.L17}"

    def test_L17B(self):
        assert self.l.L17B == D("200.00"), f"L17B={self.l.L17B}"

    def test_L15_total(self):
        # 1600 + 55 + 200 = 1855
        assert self.l.L15 == D("1855.00"), f"L15={self.l.L15}"

    # TVA déductible
    def test_L20(self):
        assert self.l.L20 == D("400.00")

    def test_L22(self):
        assert self.l.L22 == D("400.00")

    # Solde
    def test_L24_tva_due(self):
        # 1855 - 400 - 0 = 1455
        assert self.l.L24 == D("1455.00"), f"L24={self.l.L24}"

    def test_L25_zero(self):
        assert self.l.L25 == D("0.00")

    # Validation
    def test_no_hard_errors(self):
        assert not self.decl.has_errors, self.decl.validation_issues

    def test_no_high_deductible_warning(self):
        # 400 / 1855 ≈ 21.6% < 80%
        assert "high_deductible_ratio" not in issue_codes(self.decl)

    def test_no_refund(self):
        assert self.l.remboursement_demande is False


# ── Case 3: Crédit TVA — remboursement triggered ──────────────────────────────
#
#  Input (trimestrielle):
#    collectee_20   base= 5 000, TVA=1 000
#    deductible_20  base= 3 000, TVA=  600
#    deductible_immo base=10 000, TVA=2 000
#    credit_ant=500
#
#  Expected:
#    L08=5 000  L16=1 000
#    L15=1 000
#    L19=2 000  L20=600   L22=2 600
#    L23=500
#    net = 1000 - 2600 - 500 = -2100 → L24=0, L25=2100
#    remboursement_demande=True (2100 >= 760 trimestriel)
#    remboursement_montant=2100
#    warning: high_deductible_ratio (2600/1000=260%)
#    warning: refund_request_trimestrielle

CASE3_ENTRIES = [
    ClassifiedEntry("collectee_20",   base_ht=D("5000.00"),  tva_amount=D("1000.00")),
    ClassifiedEntry("deductible_20",  base_ht=D("3000.00"),  tva_amount=D("600.00")),
    ClassifiedEntry("deductible_immo", base_ht=D("10000.00"), tva_amount=D("2000.00")),
]


class TestCase3CreditTVA:
    def setup_method(self):
        self.decl = _run(CASE3_ENTRIES, period_type="trimestrielle", credit_anterieur="500")
        self.l = self.decl.lines

    # Bases
    def test_L08(self):
        assert self.l.L08 == D("5000.00")

    def test_L16_tva_collectee(self):
        assert self.l.L16 == D("1000.00")

    def test_L15_total_collectee(self):
        assert self.l.L15 == D("1000.00")

    # Déductible
    def test_L19_immo(self):
        assert self.l.L19 == D("2000.00"), f"L19={self.l.L19}"

    def test_L20_autres(self):
        assert self.l.L20 == D("600.00"), f"L20={self.l.L20}"

    def test_L22_total_deductible(self):
        assert self.l.L22 == D("2600.00"), f"L22={self.l.L22}"

    # Crédit antérieur
    def test_L23_credit_anterieur(self):
        assert self.l.L23 == D("500.00"), f"L23={self.l.L23}"

    # Solde crédit
    def test_L24_zero_no_tva_due(self):
        assert self.l.L24 == D("0.00"), f"L24={self.l.L24}"

    def test_L25_credit_tva(self):
        # 2600 + 500 - 1000 = 2100
        assert self.l.L25 == D("2100.00"), f"L25={self.l.L25}"

    # Remboursement Cadre D
    def test_remboursement_demande_true(self):
        assert self.l.remboursement_demande is True, "Remboursement should be demanded (L25=2100 >= 760)"

    def test_remboursement_montant(self):
        assert self.l.remboursement_montant == D("2100.00"), f"montant={self.l.remboursement_montant}"

    # Validation — expected warnings
    def test_no_hard_errors(self):
        assert not self.decl.has_errors, self.decl.validation_issues

    def test_high_deductible_ratio_warning(self):
        # 2600 / 1000 = 260% > 80%
        assert "high_deductible_ratio" in issue_codes(self.decl), (
            f"Expected high_deductible_ratio warning, got: {issue_codes(self.decl)}"
        )

    def test_refund_warning_trimestrielle(self):
        assert "refund_request_trimestrielle" in issue_codes(self.decl), (
            f"Expected refund warning, got: {issue_codes(self.decl)}"
        )


# ── Validation hard-error tests ───────────────────────────────────────────────

class TestValidationRules:
    def test_neg_tva_collectee_raises_hard_error(self):
        """Engine flags hard error when regularisation produces negative L15."""
        entries = [
            ClassifiedEntry("collectee_20",  base_ht=D("1000"), tva_amount=D("200")),
            # Large negative regularisation that pushes L15 below zero
            ClassifiedEntry("regularisation", base_ht=D("0"), tva_amount=D("-500")),
        ]
        decl = _run(entries)
        # L15 = 200 + (-500) = -300 → hard error
        assert decl.lines.L15 == D("-300.00"), f"L15={decl.lines.L15}"
        assert decl.has_errors
        assert "neg_tva_collectee" in issue_codes(decl)

    def test_hors_champ_excluded_from_lines(self):
        """hors_champ entries do not affect any CA3 line."""
        entries = [
            ClassifiedEntry("collectee_20", base_ht=D("5000"), tva_amount=D("1000")),
            ClassifiedEntry("hors_champ",   base_ht=D("9999"), tva_amount=D("9999")),
        ]
        decl = _run(entries)
        assert decl.lines.L08 == D("5000.00")
        assert decl.lines.L16 == D("1000.00")
        assert decl.lines.L15 == D("1000.00")

    def test_non_deductible_excluded_from_deductible(self):
        """non_deductible TVA does not appear in L20 or L22."""
        entries = [
            ClassifiedEntry("collectee_20",    base_ht=D("5000"), tva_amount=D("1000")),
            ClassifiedEntry("non_deductible",  base_ht=D("3000"), tva_amount=D("600")),
        ]
        decl = _run(entries)
        assert decl.lines.L20 == D("0.00"), "non_deductible should not appear in L20"
        assert decl.lines.L22 == D("0.00")
        assert decl.lines.L24 == D("1000.00")

    def test_ambiguous_count_incremented(self):
        """Ambiguous entries are counted but not included in any line."""
        entries = [
            ClassifiedEntry("collectee_20", base_ht=D("2000"), tva_amount=D("400")),
            ClassifiedEntry("ambiguous",    base_ht=D("500"),  tva_amount=D("100")),
        ]
        decl = _run(entries)
        assert decl.ambiguous_count == 1
        assert "ambiguous_entries_present" in issue_codes(decl)
        assert decl.lines.L16 == D("400.00")  # ambiguous not added

    def test_autoliquidation_debit_adds_to_L08_L16(self):
        """autoliquidation_debit contributes to L08 (base) and L16 (TVA collectée)."""
        entries = [
            ClassifiedEntry("autoliquidation_debit",  base_ht=D("3000"), tva_amount=D("600")),
            ClassifiedEntry("autoliquidation_credit", base_ht=D("0"),    tva_amount=D("600")),
        ]
        decl = _run(entries)
        assert decl.lines.L08 == D("3000.00"), f"L08={decl.lines.L08}"
        assert decl.lines.L16 == D("600.00"),  f"L16={decl.lines.L16}"
        assert decl.lines.L20 == D("600.00"),  f"L20={decl.lines.L20}"
        # Net = 600 - 600 = 0 → no TVA due, no crédit
        assert decl.lines.L24 == D("0.00")
        assert decl.lines.L25 == D("0.00")

    def test_refund_threshold_mensuelle_1500(self):
        """Crédit TVA ≥ 1500€ in mensuelle triggers refund warning."""
        entries = [
            ClassifiedEntry("collectee_20",   base_ht=D("5000"),  tva_amount=D("1000")),
            ClassifiedEntry("deductible_immo", base_ht=D("15000"), tva_amount=D("3000")),
        ]
        decl = _run(entries, period_type="mensuelle")
        assert decl.lines.L25 == D("2000.00"), f"L25={decl.lines.L25}"
        assert decl.lines.remboursement_demande is True
        assert "refund_request_mensuelle" in issue_codes(decl)

    def test_credit_below_refund_threshold_no_demand(self):
        """Crédit TVA < 760€ trimestriel → no refund demand."""
        entries = [
            ClassifiedEntry("collectee_20",  base_ht=D("5000"),  tva_amount=D("1000")),
            ClassifiedEntry("deductible_20", base_ht=D("5500"),  tva_amount=D("1500")),
        ]
        # Credit = 500 < 760 → no demand
        decl = _run(entries, period_type="trimestrielle", credit_anterieur="0")
        # Wait, 1500 - 1000 = 500 < 760 → no refund
        assert decl.lines.L25 == D("500.00")
        assert decl.lines.remboursement_demande is False

    def test_intracom_acquisition_goes_to_A3_and_L20(self):
        """deductible_intracom: base → A3, TVA → L20."""
        entries = [
            ClassifiedEntry("deductible_intracom", base_ht=D("4000"), tva_amount=D("800")),
        ]
        decl = _run(entries)
        assert decl.lines.A3 == D("4000.00"), f"A3={decl.lines.A3}"
        assert decl.lines.L20 == D("800.00"),  f"L20={decl.lines.L20}"


# ── Audit payload test ────────────────────────────────────────────────────────

class TestAuditPayload:
    def test_audit_payload_contains_all_lines(self):
        decl = _run(CASE1_ENTRIES)
        payload = decl.to_audit_payload()
        assert "lines" in payload
        assert "engine_version" in payload
        assert payload["engine_version"] == "ca3-v1.0"
        # All major lines present
        lines = payload["lines"]
        for key in ["L08", "L15", "L16", "L20", "L22", "L24", "L25"]:
            assert key in lines, f"Missing '{key}' in audit payload"

    def test_audit_payload_decimal_as_string(self):
        """fieldsJson values are strings (not floats) for Decimal precision."""
        decl = _run(CASE1_ENTRIES)
        payload = decl.to_audit_payload()
        l24 = payload["lines"]["L24"]
        assert isinstance(l24, str), f"L24 should be str, got {type(l24)}"
        assert l24 == "1000.00"
