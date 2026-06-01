"""
CA3 Engine — deterministic TVA declaration computation.

PRINCIPLE: Zero LLM. Pure Python + Decimal. The VATClassifier has already
labelled every FEC entry with a vat_type; this engine aggregates and maps to
the official CA3 form (CERFA n° 3310-CA3-SD).

Public API
----------
  compute_ca3(fiscal_client_id, period_start, period_end, period_type,
              classified_entries, credit_tva_anterieur, org_id) -> CA3Declaration

  async load_classified_entries(fiscal_client_id, period_start, period_end, pool)
      -> list[ClassifiedEntry]    # DB loader for production use

PRD reference: §4.4 "Declaration Engine".
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from pathlib import Path
from typing import Literal, Optional

import yaml

logger = logging.getLogger(__name__)

ENGINE_VERSION = "ca3-v1.0"
CERFA = "3310-CA3-SD"

_MAPPING_PATH = Path(__file__).parent.parent.parent / "docs" / "ca3_mapping.yaml"
_REPO_ROOT_MAPPING = Path(__file__).parent.parent.parent.parent.parent / "docs" / "ca3_mapping.yaml"


def _load_mapping() -> dict:
    """Load ca3_mapping.yaml from docs/ (tries both relative paths)."""
    for p in (_MAPPING_PATH, _REPO_ROOT_MAPPING):
        if p.exists():
            with open(p, encoding="utf-8") as fh:
                return yaml.safe_load(fh)
    raise FileNotFoundError(
        "ca3_mapping.yaml not found. Expected at docs/ca3_mapping.yaml in repo root."
    )


_MAPPING: dict = _load_mapping()
_VAT_TYPE_MAP: dict[str, dict] = _MAPPING["vat_type_mapping"]
_REFUND_THRESHOLDS: dict[str, int] = _MAPPING["refund_thresholds"]


def _D(value) -> Decimal:
    """Convert any numeric value to Decimal, rounded to 2 decimals."""
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0.00")


# ── Input / output models ────────────────────────────────────────────────────

@dataclass
class ClassifiedEntry:
    """
    One aggregated (vat_type, base_ht, tva_amount) row.
    Comes from: VATClassification JOIN FECEntry WHERE period ∩ [start, end].

    base_ht and tva_amount are always positive; sign convention is implicit in vat_type:
      - collectee_* : TVA owed to DGFiP
      - deductible_* / autoliquidation_credit : TVA recoverable
      - regularisation: signed amount (use negative tva_amount for credit regularisation)
    """
    vat_type: str
    base_ht: Decimal
    tva_amount: Decimal

    def __post_init__(self) -> None:
        self.base_ht = _D(self.base_ht)
        self.tva_amount = _D(self.tva_amount)


@dataclass
class ValidationIssue:
    severity: Literal["error", "warning"]
    code: str
    message: str


@dataclass
class CA3Lines:
    """All lines of the CA3 form (CERFA 3310-CA3-SD), as Decimal strings."""

    # ── Cadre A — Montant des opérations réalisées ──────────────────────────
    A1: Decimal = field(default_factory=lambda: Decimal("0.00"))
    A2: Decimal = field(default_factory=lambda: Decimal("0.00"))
    A3: Decimal = field(default_factory=lambda: Decimal("0.00"))
    A4: Decimal = field(default_factory=lambda: Decimal("0.00"))
    A5: Decimal = field(default_factory=lambda: Decimal("0.00"))

    # ── Cadre B — Bases HT imposables ───────────────────────────────────────
    L08:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # base 20%
    L09:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # base 5,5%
    L09B: Decimal = field(default_factory=lambda: Decimal("0.00"))   # base 10%
    L10:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # base 2,1%

    # ── Cadre B — TVA collectée ──────────────────────────────────────────────
    L16:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # TVA 20%
    L17:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # TVA 5,5%
    L17B: Decimal = field(default_factory=lambda: Decimal("0.00"))   # TVA 10%
    L18:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # TVA 2,1%
    L14:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # régularisations
    L15:  Decimal = field(default_factory=lambda: Decimal("0.00"))   # total collectée brute

    # ── Cadre B — TVA déductible ─────────────────────────────────────────────
    L19: Decimal = field(default_factory=lambda: Decimal("0.00"))    # sur immobilisations
    L20: Decimal = field(default_factory=lambda: Decimal("0.00"))    # sur autres biens/services
    L22: Decimal = field(default_factory=lambda: Decimal("0.00"))    # total déductible

    # ── Cadre B — Solde ──────────────────────────────────────────────────────
    L23: Decimal = field(default_factory=lambda: Decimal("0.00"))    # crédit antérieur
    L24: Decimal = field(default_factory=lambda: Decimal("0.00"))    # TVA due (≥ 0)
    L25: Decimal = field(default_factory=lambda: Decimal("0.00"))    # crédit TVA (≥ 0)

    # ── Cadre D — Remboursement ──────────────────────────────────────────────
    remboursement_demande: bool = False
    remboursement_montant: Decimal = field(default_factory=lambda: Decimal("0.00"))

    def to_json_dict(self) -> dict[str, str]:
        """Serialise all Decimal fields as strings (for fieldsJson storage)."""
        result = {}
        for fname, fval in self.__dataclass_fields__.items():  # type: ignore[attr-defined]
            val = getattr(self, fname)
            if isinstance(val, Decimal):
                result[fname] = str(val)
            elif isinstance(val, bool):
                result[fname] = val
            else:
                result[fname] = val
        return result


@dataclass
class CA3Declaration:
    """Full CA3 declaration result."""
    fiscal_client_id: str
    period_start: date
    period_end: date
    period_type: str
    org_id: str

    lines: CA3Lines
    validation_issues: list[ValidationIssue]
    engine_version: str
    entries_count: int
    ambiguous_count: int

    @property
    def has_errors(self) -> bool:
        return any(v.severity == "error" for v in self.validation_issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [v for v in self.validation_issues if v.severity == "warning"]

    def to_audit_payload(self) -> dict:
        """Build AuditEvent payload (all lines + warnings + version)."""
        return {
            "lines": self.lines.to_json_dict(),
            "validation_warnings": [
                {"code": w.code, "message": w.message} for w in self.warnings
            ],
            "engine_version": self.engine_version,
            "entries_count": self.entries_count,
            "ambiguous_count": self.ambiguous_count,
        }


# ── Aggregation ──────────────────────────────────────────────────────────────

def _aggregate(entries: list[ClassifiedEntry]) -> dict[str, dict[str, Decimal]]:
    """
    Group entries by vat_type, summing base_ht and tva_amount.

    Returns: { vat_type: { 'base_ht': Decimal, 'tva_amount': Decimal } }
    """
    agg: dict[str, dict[str, Decimal]] = {}
    for e in entries:
        if e.vat_type not in agg:
            agg[e.vat_type] = {"base_ht": Decimal("0"), "tva_amount": Decimal("0")}
        agg[e.vat_type]["base_ht"] += e.base_ht
        agg[e.vat_type]["tva_amount"] += e.tva_amount
    return agg


def _map_to_lines(
    agg: dict[str, dict[str, Decimal]],
) -> tuple[CA3Lines, int]:
    """
    Apply vat_type_mapping from YAML to populate CA3Lines.

    Returns (lines, ambiguous_count).
    """
    lines = CA3Lines()
    ambiguous_count = 0

    for vat_type, totals in agg.items():
        mapping = _VAT_TYPE_MAP.get(vat_type)
        if mapping is None:
            logger.warning("Unknown vat_type '%s' — skipped.", vat_type)
            continue
        if vat_type == "ambiguous":
            ambiguous_count += 1
            continue

        base = _D(totals["base_ht"])
        tva = _D(totals["tva_amount"])

        base_line: Optional[str] = mapping.get("base_line")
        tva_line: Optional[str] = mapping.get("tva_line")
        cadre_a: Optional[str] = mapping.get("cadre_a")

        # Accumulate base HT
        if base_line and base_line != "~" and base:
            _add(lines, base_line, base)

        # Cadre A (informational)
        if cadre_a and cadre_a != "~" and base:
            _add(lines, cadre_a, base)

        # Accumulate TVA
        if tva_line and tva_line != "~" and tva:
            _add(lines, tva_line, tva)

    return lines, ambiguous_count


def _add(lines: CA3Lines, field_name: str, amount: Decimal) -> None:
    """Add amount to a CA3Lines field (accumulator)."""
    if hasattr(lines, field_name):
        current = getattr(lines, field_name)
        setattr(lines, field_name, _D(current + amount))
    else:
        logger.warning("CA3Lines has no field '%s' — skipped.", field_name)


def _compute_derived(lines: CA3Lines, credit_anterieur: Decimal) -> CA3Lines:
    """Compute all derived / formula lines (L15, L22, L23, L24, L25)."""
    # L15 = L16 + L17 + L17B + L18 + L14
    lines.L15 = _D(lines.L16 + lines.L17 + lines.L17B + lines.L18 + lines.L14)

    # L22 = L19 + L20
    lines.L22 = _D(lines.L19 + lines.L20)

    # L23 = credit antérieur
    lines.L23 = _D(credit_anterieur)

    # Net = L15 - L22 - L23
    net = _D(lines.L15 - lines.L22 - lines.L23)

    if net > Decimal("0"):
        lines.L24 = net        # TVA due
        lines.L25 = Decimal("0.00")
    else:
        lines.L24 = Decimal("0.00")
        lines.L25 = _D(-net)   # crédit TVA

    return lines


# ── Validation ───────────────────────────────────────────────────────────────

def _validate(
    lines: CA3Lines,
    period_type: str,
    ambiguous_count: int,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    # Hard error: negative TVA collectée
    if lines.L15 < Decimal("0"):
        issues.append(ValidationIssue(
            severity="error",
            code="neg_tva_collectee",
            message=f"La TVA collectée totale (ligne 15 = {lines.L15}) ne peut pas être négative.",
        ))

    # Hard error: L15 internal consistency
    expected_l15 = _D(lines.L16 + lines.L17 + lines.L17B + lines.L18 + lines.L14)
    if lines.L15 != expected_l15:
        issues.append(ValidationIssue(
            severity="error",
            code="l15_internal_inconsistency",
            message=(
                f"Incohérence interne : L15={lines.L15} ≠ "
                f"L16+L17+L17B+L18+L14={expected_l15}."
            ),
        ))

    # Warning: high deductible ratio
    if lines.L15 > Decimal("0"):
        ratio = lines.L22 / lines.L15
        if ratio > Decimal("0.80"):
            issues.append(ValidationIssue(
                severity="warning",
                code="high_deductible_ratio",
                message=(
                    f"Ratio TVA déductible/collectée = {ratio:.0%} (> 80%) — "
                    "anomalie potentielle, vérifier les entrées."
                ),
            ))

    # Warning: ambiguous entries ignored
    if ambiguous_count > 0:
        issues.append(ValidationIssue(
            severity="warning",
            code="ambiguous_entries_present",
            message=(
                f"{ambiguous_count} écriture(s) non classifiée(s) (ambiguous) "
                "ignorée(s) — révision manuelle recommandée."
            ),
        ))

    # Warning: refund opportunity
    threshold = _D(_REFUND_THRESHOLDS.get(period_type, 760))
    if lines.L25 >= threshold:
        issues.append(ValidationIssue(
            severity="warning",
            code=f"refund_request_{period_type}",
            message=(
                f"Crédit TVA de {lines.L25} € ≥ seuil {threshold} € "
                f"({period_type}) — demande de remboursement possible (art. 242-0 A)."
            ),
        ))

    return issues


def _set_refund(lines: CA3Lines, period_type: str) -> CA3Lines:
    """Populate Cadre D remboursement fields."""
    threshold = _D(_REFUND_THRESHOLDS.get(period_type, 760))
    if lines.L25 >= threshold:
        lines.remboursement_demande = True
        lines.remboursement_montant = lines.L25
    return lines


# ── Main computation function ─────────────────────────────────────────────────

def compute_ca3(
    fiscal_client_id: str,
    period_start: date,
    period_end: date,
    period_type: Literal["mensuelle", "trimestrielle"],
    classified_entries: list[ClassifiedEntry],
    credit_tva_anterieur: Decimal = Decimal("0"),
    org_id: str = "",
) -> CA3Declaration:
    """
    Compute a full CA3 declaration from pre-classified FEC entries.

    Parameters
    ----------
    fiscal_client_id : str
        UUID of the FiscalClient (as string).
    period_start, period_end : date
        Inclusive period boundaries; entries must already be filtered.
    period_type : 'mensuelle' | 'trimestrielle'
    classified_entries : list[ClassifiedEntry]
        All VATClassification rows for this period (base_ht + tva_amount).
        Out-of-scope types (hors_champ, non_deductible) are silently excluded.
    credit_tva_anterieur : Decimal
        Crédit TVA reporté de la période précédente (ligne 23).
    org_id : str
        Organization ID for audit event.

    Returns
    -------
    CA3Declaration
        Fully computed declaration with all lines as Decimal and validation issues.
    """
    logger.info(
        "compute_ca3: fiscal_client=%s period=%s → %s (%s) entries=%d",
        fiscal_client_id, period_start, period_end, period_type,
        len(classified_entries),
    )

    # 1. Aggregate by vat_type
    agg = _aggregate(classified_entries)

    # 2. Map to form lines
    lines, ambiguous_count = _map_to_lines(agg)

    # 3. Compute derived lines (L15, L22, L23, L24, L25)
    lines = _compute_derived(lines, _D(credit_tva_anterieur))

    # 4. Cadre D — remboursement
    lines = _set_refund(lines, period_type)

    # 5. Validate
    issues = _validate(lines, period_type, ambiguous_count)

    declaration = CA3Declaration(
        fiscal_client_id=fiscal_client_id,
        period_start=period_start,
        period_end=period_end,
        period_type=period_type,
        org_id=org_id,
        lines=lines,
        validation_issues=issues,
        engine_version=ENGINE_VERSION,
        entries_count=len(classified_entries),
        ambiguous_count=ambiguous_count,
    )

    if declaration.has_errors:
        logger.error(
            "compute_ca3: %d hard error(s) for fiscal_client=%s",
            sum(1 for i in issues if i.severity == "error"),
            fiscal_client_id,
        )
    else:
        logger.info(
            "compute_ca3: OK — L24(due)=%s L25(crédit)=%s warnings=%d",
            lines.L24, lines.L25,
            len(declaration.warnings),
        )

    return declaration


# ── DB loader (production — requires asyncpg) ─────────────────────────────────

async def load_classified_entries(
    fiscal_client_id: str,
    period_start: date,
    period_end: date,
    pool,  # asyncpg.Pool
    org_id: Optional[str] = None,
) -> list[ClassifiedEntry]:
    """
    Load VATClassification rows joined with FECEntry for the given period.

    Joins:
      vat_classifications vc
      JOIN fec_entries fe ON vc.fec_entry_id = fe.id
      JOIN fec_imports fi ON fe.fec_import_id = fi.id
      WHERE fi.fiscal_client_id = $1
        AND fe.ecriture_date BETWEEN $2 AND $3
        [AND fi.org_id = $4]
    """
    query = """
        SELECT
            vc.vat_type,
            vc.base_ht,
            vc.tva_amount
        FROM vat_classifications vc
        JOIN fec_entries fe ON vc.fec_entry_id = fe.id
        JOIN fec_imports fi ON fe.fec_import_id = fi.id
        WHERE fi.fiscal_client_id = $1
          AND fe.ecriture_date BETWEEN $2 AND $3
    """
    params: list = [fiscal_client_id, period_start, period_end]

    if org_id:
        query += " AND fi.org_id = $4"
        params.append(org_id)

    rows = await pool.fetch(query, *params)
    return [
        ClassifiedEntry(
            vat_type=row["vat_type"],
            base_ht=Decimal(str(row["base_ht"])),
            tva_amount=Decimal(str(row["tva_amount"])),
        )
        for row in rows
    ]


# ── Audit event emitter ───────────────────────────────────────────────────────

async def emit_ca3_audit_event(
    declaration: CA3Declaration,
    pool,  # asyncpg.Pool
    actor_id: str = "system",
) -> None:
    """Write ca3.computed AuditEvent to Postgres (non-fatal)."""
    try:
        await pool.execute(
            """
            INSERT INTO audit_events
              (org_id, actor_type, actor_id, action, entity_type, entity_id, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            """,
            declaration.org_id or "system",
            "agent",
            actor_id,
            "ca3.computed",
            "CA3Declaration",
            declaration.fiscal_client_id,
            json.dumps(declaration.to_audit_payload()),
        )
        logger.info("Audit event ca3.computed emitted.")
    except Exception as exc:
        logger.warning("Audit event emit failed (non-fatal): %s", exc)
