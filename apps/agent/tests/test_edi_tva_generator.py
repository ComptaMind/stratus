"""
Tests for EDI-TVA XML Generator.

Three fixture CA3 declarations (matching test_ca3_engine.py cases):
  Case 1: Simple SMB — 20% only, TVA due 1 000 €
  Case 2: Mixed taux (20 % + 10 % + 5.5 %), TVA due 1 455 €
  Case 3: Crédit TVA trimestrielle, remboursement requested

For each declaration the tests assert:
  - XSD validation passes
  - SHA-256 is stable (deterministic bytes given fixed emission_date)
  - Snapshot comparison (first run writes; subsequent runs compare byte-for-byte)
  - Key XML elements are present and correct

PRD reference: §4.5 "EDI-TVA Export".
"""
from __future__ import annotations

import hashlib
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from lxml import etree

from src.declarations.ca3_engine import CA3Declaration, CA3Lines, ValidationIssue
from src.declarations.edi_tva_generator import (
    EDIValidationError,
    FiscalClientInfo,
    NAMESPACE,
    generate_edi_tva_xml,
)

# ── Paths ─────────────────────────────────────────────────────────────────────

_SNAPSHOT_DIR = Path(__file__).parent / "fixtures" / "expected_xml"
_SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

# Fixed emission date: makes SHA-256 deterministic across days
_EMISSION_DATE = date(2025, 2, 5)

# Test client info (synthetic SIRET — not a real entity)
_CLIENT_INFO = FiscalClientInfo(
    siret="12345678901234",
    raison_sociale="Société Test SARL",
    regime_tva="mensuelle",
)

_CLIENT_INFO_TRIM = FiscalClientInfo(
    siret="12345678901234",
    raison_sociale="Société Test SARL",
    regime_tva="trimestrielle",
)

PERIOD_START_M  = date(2025, 1, 1)
PERIOD_END_M    = date(2025, 1, 31)
PERIOD_START_Q  = date(2025, 1, 1)
PERIOD_END_Q    = date(2025, 3, 31)
CLIENT_ID       = "client-test-001"
ORG_ID          = "org-test-001"


def D(s: str) -> Decimal:
    return Decimal(s)


# ── Fixture builders ──────────────────────────────────────────────────────────


def _make_decl_case1() -> CA3Declaration:
    """Simple SMB — 20 % only, TVA due 1 000 €."""
    lines = CA3Lines(
        A1=D("10000.00"),
        L08=D("10000.00"),
        L16=D("2000.00"),
        L15=D("2000.00"),
        L20=D("1000.00"),
        L22=D("1000.00"),
        L24=D("1000.00"),
    )
    return CA3Declaration(
        fiscal_client_id=CLIENT_ID,
        period_start=PERIOD_START_M,
        period_end=PERIOD_END_M,
        period_type="mensuelle",
        org_id=ORG_ID,
        lines=lines,
        validation_issues=[],
        engine_version="ca3-v1.0",
        entries_count=2,
        ambiguous_count=0,
    )


def _make_decl_case2() -> CA3Declaration:
    """Mixed taux (20 % + 10 % + 5.5 %), TVA due 1 455 €."""
    lines = CA3Lines(
        A1=D("8000.00"),
        A2=D("3000.00"),
        L08=D("8000.00"),
        L09B=D("2000.00"),
        L09=D("1000.00"),
        L16=D("1600.00"),
        L17B=D("200.00"),
        L17=D("55.00"),
        L15=D("1855.00"),
        L20=D("400.00"),
        L22=D("400.00"),
        L24=D("1455.00"),
    )
    return CA3Declaration(
        fiscal_client_id=CLIENT_ID,
        period_start=PERIOD_START_M,
        period_end=PERIOD_END_M,
        period_type="mensuelle",
        org_id=ORG_ID,
        lines=lines,
        validation_issues=[
            ValidationIssue("warning", "ambiguous_entries_present", "1 écriture(s) ambiguë(s)")
        ],
        engine_version="ca3-v1.0",
        entries_count=4,
        ambiguous_count=1,
    )


def _make_decl_case3() -> CA3Declaration:
    """Crédit TVA trimestrielle, remboursement requested."""
    lines = CA3Lines(
        A1=D("5000.00"),
        L08=D("5000.00"),
        L16=D("1000.00"),
        L15=D("1000.00"),
        L19=D("2000.00"),
        L20=D("600.00"),
        L22=D("2600.00"),
        L23=D("500.00"),
        L25=D("2100.00"),
        remboursement_demande=True,
        remboursement_montant=D("2100.00"),
    )
    return CA3Declaration(
        fiscal_client_id=CLIENT_ID,
        period_start=PERIOD_START_Q,
        period_end=PERIOD_END_Q,
        period_type="trimestrielle",
        org_id=ORG_ID,
        lines=lines,
        validation_issues=[
            ValidationIssue("warning", "refund_request_trimestrielle", "Remboursement ≥ 760 €")
        ],
        engine_version="ca3-v1.0",
        entries_count=3,
        ambiguous_count=0,
    )


# ── Snapshot helper ───────────────────────────────────────────────────────────


def _snapshot_path(name: str) -> Path:
    return _SNAPSHOT_DIR / f"{name}.xml"


def _assert_snapshot(xml_bytes: bytes, name: str) -> None:
    """
    Snapshot assertion: write on first run, compare byte-for-byte thereafter.
    Set env var STRATUS_UPDATE_SNAPSHOTS=1 to force-update all snapshots.
    """
    import os
    snap = _snapshot_path(name)
    if snap.exists() and not os.getenv("STRATUS_UPDATE_SNAPSHOTS"):
        assert xml_bytes == snap.read_bytes(), (
            f"Snapshot mismatch for {name}. "
            "Run with STRATUS_UPDATE_SNAPSHOTS=1 to update."
        )
    else:
        snap.write_bytes(xml_bytes)


# ── XSD schema helper ─────────────────────────────────────────────────────────


def _load_schema() -> etree.XMLSchema:
    from pathlib import Path as P
    xsd_path = (
        P(__file__).parent.parent
        / "src" / "declarations" / "schemas" / "edi_tva.xsd"
    )
    return etree.XMLSchema(etree.parse(str(xsd_path)))


SCHEMA = _load_schema()


def _ns(tag: str) -> str:
    return f"{{{NAMESPACE}}}{tag}"


def _find(root: etree._Element, *path: str) -> etree._Element | None:
    """Walk path of unqualified tag names under NAMESPACE."""
    el = root
    for tag in path:
        el = el.find(_ns(tag))
        if el is None:
            return None
    return el


def _text(root: etree._Element, *path: str) -> str:
    el = _find(root, *path)
    return el.text or "" if el is not None else ""


def _montant(cadre: etree._Element, ref: str) -> str:
    """Find <Ligne ref="..."><Montant> inside a cadre."""
    for ligne in cadre.findall(_ns("Ligne")):
        if ligne.get("ref") == ref:
            m = ligne.find(_ns("Montant"))
            return m.text or "" if m is not None else ""
    return ""


# ── Case 1 tests ──────────────────────────────────────────────────────────────


class TestCase1SimpleSMB:
    @pytest.fixture(scope="class")
    def result(self):
        decl = _make_decl_case1()
        xml_bytes, sha256 = generate_edi_tva_xml(
            decl, _CLIENT_INFO, intent="LIQ", emission_date=_EMISSION_DATE
        )
        return xml_bytes, sha256, etree.fromstring(xml_bytes)

    def test_xsd_validates(self, result):
        xml_bytes, _, _ = result
        assert SCHEMA.validate(etree.fromstring(xml_bytes)), [str(e) for e in SCHEMA.error_log]

    def test_sha256_is_hex_string(self, result):
        _, sha256, _ = result
        assert len(sha256) == 64
        int(sha256, 16)  # raises if not valid hex

    def test_sha256_stable(self, result):
        """Same declaration + fixed emission_date → identical SHA-256."""
        decl = _make_decl_case1()
        _, sha256b = generate_edi_tva_xml(
            decl, _CLIENT_INFO, intent="LIQ", emission_date=_EMISSION_DATE
        )
        _, sha256a = result[0], result[1]
        assert sha256a == sha256b

    def test_bytes_deterministic(self, result):
        """Same inputs → byte-for-byte identical XML."""
        decl = _make_decl_case1()
        xml2, _ = generate_edi_tva_xml(
            decl, _CLIENT_INFO, intent="LIQ", emission_date=_EMISSION_DATE
        )
        assert result[0] == xml2

    def test_snapshot(self, result):
        _assert_snapshot(result[0], "case1_simple_smb")

    def test_root_element(self, result):
        _, _, root = result
        assert root.tag == _ns("Echange")
        assert root.get("version") == "1.0"

    def test_entete_regime(self, result):
        _, _, root = result
        assert _text(root, "Entete", "Regime") == "TVA-CA3"

    def test_entete_siret(self, result):
        _, _, root = result
        assert _text(root, "Entete", "SiretEmetteur") == "12345678901234"

    def test_entete_dac_intent(self, result):
        _, _, root = result
        assert _text(root, "Entete", "DacIntent") == "LIQ"

    def test_entete_periode(self, result):
        _, _, root = result
        assert _text(root, "Entete", "Periode", "DateDebut") == "2025-01-01"
        assert _text(root, "Entete", "Periode", "DateFin")   == "2025-01-31"

    def test_cerfa_attribute(self, result):
        _, _, root = result
        decl_el = _find(root, "Declaration")
        assert decl_el is not None
        assert decl_el.get("cerfa") == "3310-CA3-SD"

    def test_cadre_b_L08(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L08") == "10000.00"

    def test_cadre_b_L16(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L16") == "2000.00"

    def test_cadre_b_L15(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L15") == "2000.00"

    def test_cadre_b_L24_tva_due(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L24") == "1000.00"

    def test_cadre_b_L25_zero(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L25") == "0.00"

    def test_cadre_d_no_refund(self, result):
        _, _, root = result
        cadre_d = _find(root, "Declaration", "CadreD")
        assert cadre_d is not None
        remb = cadre_d.find(_ns("RemboursementDemande"))
        assert remb is not None and remb.text == "false"

    def test_signature_present(self, result):
        _, _, root = result
        sig = _find(root, "Signature")
        assert sig is not None
        assert _text(root, "Signature", "Algorithm") == "SHA-256"
        digest = _find(root, "Signature", "DigestValue")
        assert digest is not None and len(digest.text or "") > 0


# ── Case 2 tests ──────────────────────────────────────────────────────────────


class TestCase2MixedTaux:
    @pytest.fixture(scope="class")
    def result(self):
        decl = _make_decl_case2()
        xml_bytes, sha256 = generate_edi_tva_xml(
            decl, _CLIENT_INFO, intent="LIQ", emission_date=_EMISSION_DATE
        )
        return xml_bytes, sha256, etree.fromstring(xml_bytes)

    def test_xsd_validates(self, result):
        xml_bytes, _, _ = result
        assert SCHEMA.validate(etree.fromstring(xml_bytes)), [str(e) for e in SCHEMA.error_log]

    def test_sha256_stable(self, result):
        decl = _make_decl_case2()
        _, sha256b = generate_edi_tva_xml(
            decl, _CLIENT_INFO, intent="LIQ", emission_date=_EMISSION_DATE
        )
        assert result[1] == sha256b

    def test_bytes_deterministic(self, result):
        decl = _make_decl_case2()
        xml2, _ = generate_edi_tva_xml(
            decl, _CLIENT_INFO, intent="LIQ", emission_date=_EMISSION_DATE
        )
        assert result[0] == xml2

    def test_snapshot(self, result):
        _assert_snapshot(result[0], "case2_mixed_taux")

    def test_L08_base_20pct(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L08") == "8000.00"

    def test_L09B_base_10pct(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L09B") == "2000.00"

    def test_L09_base_55pct(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L09") == "1000.00"

    def test_L15_total_collectee(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L15") == "1855.00"

    def test_L24_tva_due(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L24") == "1455.00"

    def test_cadre_a_A1_A2(self, result):
        _, _, root = result
        cadre_a = _find(root, "Declaration", "CadreA")
        assert _montant(cadre_a, "A1") == "8000.00"
        assert _montant(cadre_a, "A2") == "3000.00"

    def test_different_sha256_from_case1(self, result):
        decl1 = _make_decl_case1()
        _, sha1 = generate_edi_tva_xml(
            decl1, _CLIENT_INFO, intent="LIQ", emission_date=_EMISSION_DATE
        )
        assert result[1] != sha1, "Case 1 and Case 2 should have different SHA-256"


# ── Case 3 tests ──────────────────────────────────────────────────────────────


class TestCase3CreditTVA:
    @pytest.fixture(scope="class")
    def result(self):
        decl = _make_decl_case3()
        xml_bytes, sha256 = generate_edi_tva_xml(
            decl, _CLIENT_INFO_TRIM, intent="LIQ", emission_date=_EMISSION_DATE
        )
        return xml_bytes, sha256, etree.fromstring(xml_bytes)

    def test_xsd_validates(self, result):
        xml_bytes, _, _ = result
        assert SCHEMA.validate(etree.fromstring(xml_bytes)), [str(e) for e in SCHEMA.error_log]

    def test_sha256_stable(self, result):
        decl = _make_decl_case3()
        _, sha256b = generate_edi_tva_xml(
            decl, _CLIENT_INFO_TRIM, intent="LIQ", emission_date=_EMISSION_DATE
        )
        assert result[1] == sha256b

    def test_bytes_deterministic(self, result):
        decl = _make_decl_case3()
        xml2, _ = generate_edi_tva_xml(
            decl, _CLIENT_INFO_TRIM, intent="LIQ", emission_date=_EMISSION_DATE
        )
        assert result[0] == xml2

    def test_snapshot(self, result):
        _assert_snapshot(result[0], "case3_credit_tva")

    def test_regime_trimestrielle(self, result):
        _, _, root = result
        assert _text(root, "Entete", "Regime") == "TVA-CA3-TRIM"

    def test_L25_credit_tva(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L25") == "2100.00"

    def test_L24_zero(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L24") == "0.00"

    def test_L23_credit_anterieur(self, result):
        _, _, root = result
        cadre_b = _find(root, "Declaration", "CadreB")
        assert _montant(cadre_b, "L23") == "500.00"

    def test_cadre_d_refund_requested(self, result):
        _, _, root = result
        cadre_d = _find(root, "Declaration", "CadreD")
        assert cadre_d is not None
        remb = cadre_d.find(_ns("RemboursementDemande"))
        assert remb is not None and remb.text == "true"

    def test_cadre_d_refund_montant(self, result):
        _, _, root = result
        cadre_d = _find(root, "Declaration", "CadreD")
        assert cadre_d is not None
        m = cadre_d.find(_ns("RemboursementMontant"))
        assert m is not None and m.text == "2100.00"

    def test_periode_trimestrielle(self, result):
        _, _, root = result
        assert _text(root, "Entete", "Periode", "DateDebut") == "2025-01-01"
        assert _text(root, "Entete", "Periode", "DateFin")   == "2025-03-31"


# ── Validation error tests ────────────────────────────────────────────────────


class TestValidation:
    def test_invalid_siret_raises(self):
        with pytest.raises(ValueError, match="SIRET invalide"):
            FiscalClientInfo(siret="123", raison_sociale="Test", regime_tva="mensuelle")

    def test_siret_spaces_normalised(self):
        ci = FiscalClientInfo(
            siret="123 456 789 012 34",
            raison_sociale="Test",
            regime_tva="mensuelle",
        )
        assert ci.siret == "12345678901234"

    def test_edi_validation_error_on_bad_xml(self):
        """Manually corrupt the XML to trigger EDIValidationError."""
        from src.declarations.edi_tva_generator import _validate_xsd
        bad_xml = b'<?xml version="1.0" encoding="UTF-8"?><root/>'
        with pytest.raises(EDIValidationError):
            _validate_xsd(bad_xml)

    def test_intent_test_mode(self):
        """intent='TEST' should still produce valid XML."""
        decl = _make_decl_case1()
        xml_bytes, _ = generate_edi_tva_xml(
            decl, _CLIENT_INFO, intent="TEST", emission_date=_EMISSION_DATE
        )
        root = etree.fromstring(xml_bytes)
        assert _text(root, "Entete", "DacIntent") == "TEST"
        assert SCHEMA.validate(root)

    def test_no_client_info_uses_placeholder(self):
        """Calling without client_info still produces valid XSD-compliant XML."""
        # fiscal_client_id has no digits → all-zero SIRET placeholder
        decl = _make_decl_case1()
        # Override fiscal_client_id to one with digits so SIRET is non-trivial
        from dataclasses import replace
        decl2 = CA3Declaration(
            fiscal_client_id="99887766554433",
            period_start=decl.period_start,
            period_end=decl.period_end,
            period_type=decl.period_type,
            org_id=decl.org_id,
            lines=decl.lines,
            validation_issues=decl.validation_issues,
            engine_version=decl.engine_version,
            entries_count=decl.entries_count,
            ambiguous_count=decl.ambiguous_count,
        )
        xml_bytes, _ = generate_edi_tva_xml(decl2, emission_date=_EMISSION_DATE)
        assert SCHEMA.validate(etree.fromstring(xml_bytes))


# ── SHA-256 integrity ─────────────────────────────────────────────────────────


class TestSHA256:
    def test_sha256_matches_digest_in_xml(self):
        """SHA-256 returned by function == DigestValue in <Signature> (b64-decoded)."""
        import base64
        decl = _make_decl_case1()
        xml_bytes, sha256_hex = generate_edi_tva_xml(
            decl, _CLIENT_INFO, emission_date=_EMISSION_DATE
        )
        root = etree.fromstring(xml_bytes)
        b64 = _text(root, "Signature", "DigestValue")
        digest_bytes = base64.b64decode(b64)
        assert digest_bytes.hex() == sha256_hex

    def test_sha256_hex_length(self):
        decl = _make_decl_case1()
        _, sha256_hex = generate_edi_tva_xml(decl, _CLIENT_INFO, emission_date=_EMISSION_DATE)
        assert len(sha256_hex) == 64

    def test_different_declarations_different_hash(self):
        d1 = _make_decl_case1()
        d2 = _make_decl_case2()
        _, h1 = generate_edi_tva_xml(d1, _CLIENT_INFO, emission_date=_EMISSION_DATE)
        _, h2 = generate_edi_tva_xml(d2, _CLIENT_INFO, emission_date=_EMISSION_DATE)
        assert h1 != h2

    def test_sha256_changes_with_different_emission_date(self):
        decl = _make_decl_case1()
        _, h1 = generate_edi_tva_xml(decl, _CLIENT_INFO, emission_date=date(2025, 2, 5))
        _, h2 = generate_edi_tva_xml(decl, _CLIENT_INFO, emission_date=date(2025, 3, 1))
        assert h1 != h2
