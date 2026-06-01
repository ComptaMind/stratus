"""
EDI-TVA XML Generator — Stratus MVP.

Generates a DGFiP-compatible TDFC/INFENT XML file for the CA3 monthly
TVA declaration (CERFA 3310-CA3-SD).

Public API
----------
  generate_edi_tva_xml(declaration, client_info) -> tuple[bytes, str]
      Returns (xml_bytes, sha256_hex).

  upload_to_s3(xml_bytes, key_prefix, bucket) -> str
      Upload to Scaleway S3, return public URL.  Requires boto3 + env vars.

Signature
---------
  MVP: SHA-256 of the canonical <Entete>+<Declaration> bytes (UTF-8).
  Post-MVP: eIDAS XAdES-T (qualified timestamp authority).

XSD validation
--------------
  Performed automatically in generate_edi_tva_xml(); raises EDIValidationError
  on schema violations.

PRD reference: §4.5 "EDI-TVA Export".
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from xml.etree import ElementTree as ET

from lxml import etree

from .ca3_engine import CA3Declaration, CA3Lines

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

NAMESPACE    = "urn:dgfip:edi:tva:ca3:v1"
NS_PREFIX    = "tva"
EDI_VERSION  = "1.0"
CERFA        = "3310-CA3-SD"

# XSD schema path (relative to this file)
_XSD_PATH = (
    __import__("pathlib").Path(__file__).parent / "schemas" / "edi_tva.xsd"
)

# ── Custom exception ───────────────────────────────────────────────────────────


class EDIValidationError(ValueError):
    """Raised when the generated XML fails XSD validation."""

    def __init__(self, message: str, errors: list[str]) -> None:
        super().__init__(message)
        self.errors = errors


# ── Input model ───────────────────────────────────────────────────────────────


@dataclass
class FiscalClientInfo:
    """
    Minimal fiscal-client metadata required for the EDI envelope.

    Attributes
    ----------
    siret :
        14-digit SIRET of the declaring entity.
    raison_sociale :
        Legal name (shown in IntituleEmetteur).
    regime_tva :
        "mensuelle" (→ regime TVA-CA3) or "trimestrielle" (→ TVA-CA3-TRIM).
    """
    siret: str
    raison_sociale: str
    regime_tva: str = "mensuelle"

    def __post_init__(self) -> None:
        clean = self.siret.replace(" ", "")
        if not clean.isdigit() or len(clean) != 14:
            raise ValueError(f"SIRET invalide: {self.siret!r} (doit être 14 chiffres)")
        self.siret = clean


# ── Namespace helper ──────────────────────────────────────────────────────────


def _ns(tag: str) -> str:
    """Return Clark-notation tag: {namespace}tag."""
    return f"{{{NAMESPACE}}}{tag}"


# ── Placeholder helper ────────────────────────────────────────────────────────


def _placeholder_client_info(declaration: CA3Declaration) -> FiscalClientInfo:
    """
    Build a FiscalClientInfo from the CA3Declaration when none is supplied.

    Uses a zero-padded SIRET derived from fiscal_client_id for testing.
    Production callers MUST supply a real FiscalClientInfo.
    """
    # Derive a valid-looking 14-digit SIRET: take digits from fiscal_client_id,
    # left-pad/truncate to 14 chars.  Purely synthetic — not a real SIRET.
    raw_digits = "".join(c for c in declaration.fiscal_client_id if c.isdigit())
    siret = raw_digits[:14].ljust(14, "0") if raw_digits else "0" * 14
    return FiscalClientInfo(
        siret=siret,
        raison_sociale=declaration.fiscal_client_id,
        regime_tva=declaration.period_type,
    )


# ── Core generator ────────────────────────────────────────────────────────────


def generate_edi_tva_xml(
    declaration: CA3Declaration,
    client_info: Optional[FiscalClientInfo] = None,
    intent: str = "LIQ",
    emission_date: Optional[date] = None,
) -> tuple[bytes, str]:
    """
    Build, validate and return the EDI-TVA XML for a CA3 declaration.

    Parameters
    ----------
    declaration :
        Computed CA3Declaration (from ca3_engine.compute_ca3).
    client_info :
        Emitter identity (SIRET, raison sociale, regime).
        When None, a placeholder is built from declaration.fiscal_client_id
        (suitable for tests and sandbox submissions).
    intent :
        "LIQ" (production), "RECT" (rectificatif), or "TEST" (sandbox).
    emission_date :
        Override emission date (defaults to today UTC).  Pass a fixed date
        in tests to make the output deterministic (SHA-256 stable).

    Returns
    -------
    tuple[bytes, str]
        (utf-8 xml bytes, sha256 hex digest of signed content)

    Raises
    ------
    EDIValidationError
        If the generated XML fails XSD schema validation.
    """
    if client_info is None:
        client_info = _placeholder_client_info(declaration)
    if emission_date is None:
        emission_date = datetime.now(timezone.utc).date()

    regime = (
        "TVA-CA3-TRIM"
        if declaration.period_type == "trimestrielle"
        else "TVA-CA3"
    )

    # ── 1. Build XML tree ──────────────────────────────────────────────────────
    root = etree.Element(
        _ns("Echange"),
        nsmap={None: NAMESPACE},
        attrib={"version": EDI_VERSION},
    )

    entete_el  = _build_entete(root, client_info, declaration, intent, regime, emission_date)
    decl_el    = _build_declaration(root, declaration.lines)
    signed_bytes = _canonical_bytes(entete_el, decl_el)

    # ── 2. Compute SHA-256 digest ──────────────────────────────────────────────
    digest_bytes = hashlib.sha256(signed_bytes).digest()
    sha256_hex   = hashlib.sha256(signed_bytes).hexdigest()
    digest_b64   = base64.b64encode(digest_bytes).decode("ascii")

    # ── 3. Append Signature element ────────────────────────────────────────────
    _build_signature(root, digest_b64)

    # ── 4. Serialise ──────────────────────────────────────────────────────────
    xml_bytes = etree.tostring(
        root,
        pretty_print=True,
        xml_declaration=True,
        encoding="UTF-8",
    )

    # ── 5. XSD validation ──────────────────────────────────────────────────────
    _validate_xsd(xml_bytes)

    logger.info(
        "EDI-TVA generated: client=%s period=%s/%s sha256=%s…",
        declaration.fiscal_client_id,
        declaration.period_start,
        declaration.period_end,
        sha256_hex[:16],
    )
    return xml_bytes, sha256_hex


# ── Sub-builders ──────────────────────────────────────────────────────────────


def _build_entete(
    root: etree._Element,
    client: FiscalClientInfo,
    decl: CA3Declaration,
    intent: str,
    regime: str,
    emission_date: date,
) -> etree._Element:
    el = etree.SubElement(root, _ns("Entete"))
    _text(el, "SiretEmetteur",    client.siret)
    _text(el, "IntituleEmetteur", client.raison_sociale)
    _text(el, "DacIntent",        intent)
    _text(el, "Regime",           regime)

    periode = etree.SubElement(el, _ns("Periode"))
    _text(periode, "DateDebut", decl.period_start.isoformat())
    _text(periode, "DateFin",   decl.period_end.isoformat())

    _text(el, "DateEmission", emission_date.isoformat())
    _text(el, "Identifiant",  decl.fiscal_client_id)
    return el


def _build_declaration(
    root: etree._Element,
    lines: CA3Lines,
) -> etree._Element:
    el = etree.SubElement(root, _ns("Declaration"), attrib={"cerfa": CERFA})

    # ── Cadre A ────────────────────────────────────────────────────────────────
    cadre_a = etree.SubElement(el, _ns("CadreA"), attrib={"ref": "A"})
    for ref in ("A1", "A2", "A3", "A4", "A5"):
        _ligne(cadre_a, ref, getattr(lines, ref))

    # ── Cadre B ────────────────────────────────────────────────────────────────
    cadre_b = etree.SubElement(el, _ns("CadreB"), attrib={"ref": "B"})
    for ref in (
        "L08", "L09", "L09B", "L10",           # bases HT imposables
        "L14", "L15", "L16", "L17", "L17B", "L18",  # TVA collectée
        "L19", "L20", "L22",                    # TVA déductible
        "L23", "L24", "L25",                    # solde
    ):
        val = getattr(lines, ref)
        _ligne(cadre_b, ref, val)

    # ── Cadre D ────────────────────────────────────────────────────────────────
    cadre_d = etree.SubElement(el, _ns("CadreD"), attrib={"ref": "D"})
    remb_el = etree.SubElement(cadre_d, _ns("RemboursementDemande"))
    remb_el.text = "true" if lines.remboursement_demande else "false"
    montant_el = etree.SubElement(cadre_d, _ns("RemboursementMontant"))
    montant_el.text = _fmt(lines.remboursement_montant)

    return el


def _build_signature(root: etree._Element, digest_b64: str) -> None:
    sig = etree.SubElement(root, _ns("Signature"))
    _text(sig, "Algorithm",   "SHA-256")
    _text(sig, "DigestValue", digest_b64)


# ── XML helpers ───────────────────────────────────────────────────────────────


def _text(parent: etree._Element, tag: str, value: str) -> etree._Element:
    el = etree.SubElement(parent, _ns(tag))
    el.text = value
    return el


def _ligne(cadre: etree._Element, ref: str, amount: Decimal) -> etree._Element:
    ligne = etree.SubElement(cadre, _ns("Ligne"), attrib={"ref": ref})
    montant = etree.SubElement(ligne, _ns("Montant"))
    montant.text = _fmt(amount)
    return ligne


def _fmt(amount: Decimal) -> str:
    """Format a Decimal as a string with exactly 2 decimal places."""
    return f"{amount:.2f}"


def _canonical_bytes(
    entete_el: etree._Element,
    decl_el: etree._Element,
) -> bytes:
    """
    Canonical bytes for SHA-256 signing:
      UTF-8 serialisation of <Entete> + <Declaration> concatenated.
    """
    return (
        etree.tostring(entete_el, encoding="unicode")
        + etree.tostring(decl_el, encoding="unicode")
    ).encode("utf-8")


# ── XSD validation ─────────────────────────────────────────────────────────────


def _validate_xsd(xml_bytes: bytes) -> None:
    """
    Parse and validate xml_bytes against the bundled edi_tva.xsd.

    Raises EDIValidationError with all error messages on failure.
    """
    try:
        xsd_doc  = etree.parse(str(_XSD_PATH))
        schema   = etree.XMLSchema(xsd_doc)
        doc      = etree.fromstring(xml_bytes)
        valid    = schema.validate(doc)
    except etree.XMLSyntaxError as exc:
        raise EDIValidationError("XML mal formé", [str(exc)]) from exc

    if not valid:
        errors = [str(e) for e in schema.error_log]  # type: ignore[attr-defined]
        raise EDIValidationError(
            f"Le XML EDI-TVA ne respecte pas le schéma XSD ({len(errors)} erreur(s))",
            errors,
        )


# ── S3 upload ─────────────────────────────────────────────────────────────────


async def upload_to_s3(
    xml_bytes: bytes,
    key_prefix: str,
    bucket: Optional[str] = None,
) -> str:
    """
    Upload xml_bytes to Scaleway Object Storage (S3-compatible).

    Environment variables:
      SCALEWAY_ACCESS_KEY, SCALEWAY_SECRET_KEY,
      SCALEWAY_ENDPOINT_URL (e.g. https://s3.fr-par.scw.cloud),
      STRATUS_EDI_BUCKET    (default: stratus-edi-tva)

    Returns the object URL (s3://bucket/key).
    Degrades gracefully when boto3 / credentials are absent.
    """
    bucket = bucket or os.getenv("STRATUS_EDI_BUCKET", "stratus-edi-tva")
    key    = f"{key_prefix}.xml"

    try:
        import aioboto3  # type: ignore[import]
        session = aioboto3.Session(
            aws_access_key_id     = os.getenv("SCALEWAY_ACCESS_KEY"),
            aws_secret_access_key = os.getenv("SCALEWAY_SECRET_KEY"),
        )
        endpoint = os.getenv(
            "SCALEWAY_ENDPOINT_URL", "https://s3.fr-par.scw.cloud"
        )
        async with session.client("s3", endpoint_url=endpoint) as s3:
            await s3.put_object(
                Bucket      = bucket,
                Key         = key,
                Body        = xml_bytes,
                ContentType = "application/xml",
            )
        url = f"s3://{bucket}/{key}"
        logger.info("EDI-TVA uploaded: %s", url)
        return url
    except Exception as exc:
        logger.warning("S3 upload skipped (%s) — returning local key", exc)
        return f"local://{key}"


# ── Audit helper ──────────────────────────────────────────────────────────────


async def emit_edi_audit_event(
    declaration: CA3Declaration,
    sha256_hex: str,
    xml_url: str,
    pool=None,
    actor_id: str = "system",
) -> None:
    """Emit AuditEvent for EDI-TVA generation (non-fatal)."""
    if pool is None:
        logger.debug(
            "emit_edi_audit_event: no pool — skipping (sha256=%s…)", sha256_hex[:16]
        )
        return

    import json
    payload = json.dumps({
        "sha256":      sha256_hex,
        "xml_url":     xml_url,
        "period":      f"{declaration.period_start}/{declaration.period_end}",
        "engine":      declaration.engine_version,
        "cerfa":       CERFA,
        "has_errors":  declaration.has_errors,
    })

    try:
        await pool.execute(
            """
            INSERT INTO audit_events
              (org_id, actor_type, actor_id, action, entity_type, entity_id, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            """,
            declaration.org_id,
            "agent",
            actor_id,
            "edi_tva.generated",
            "CA3Declaration",
            declaration.fiscal_client_id,
            payload,
        )
    except Exception as exc:
        logger.warning("emit_edi_audit_event failed (non-fatal): %s", exc)
