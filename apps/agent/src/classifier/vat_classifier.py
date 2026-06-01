"""
VATClassifier — deterministic rules + LLM fallback for FEC TVA classification.

For each FECEntry row provided, the classifier:
1. Runs the deterministic RuleEngine.
2. For ambiguous / unknown accounts, calls the LLM Gateway.
3. Persists results to the vat_classifications Postgres table (auto-created).
4. Returns a list of VATClassificationResult.

PRD reference: §5.1 "TVA Classifier".
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Any

import asyncpg

from ..llm.gateway import LLMGateway
from .rules import RuleEngine

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS vat_classifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fec_import_id   TEXT      NOT NULL,
    ecriture_num    TEXT      NOT NULL,
    compte_num      TEXT      NOT NULL,
    compte_lib      TEXT      NOT NULL,
    ecriture_lib    TEXT      NOT NULL,
    debit           NUMERIC(15,2) NOT NULL DEFAULT 0,
    credit          NUMERIC(15,2) NOT NULL DEFAULT 0,
    vat_type        TEXT      NOT NULL,
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    method          TEXT      NOT NULL CHECK (method IN ('rule', 'llm')),
    llm_reasoning   TEXT,
    organization_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fec_import_id, ecriture_num, compte_num)
);
CREATE INDEX IF NOT EXISTS vat_class_import_idx ON vat_classifications (fec_import_id);
CREATE INDEX IF NOT EXISTS vat_class_org_idx    ON vat_classifications (organization_id);
"""

_LLM_SYSTEM = """Tu es un expert comptable français spécialisé en TVA.
On te donne une ligne FEC (Fichier des Écritures Comptables). Classe-la selon son type TVA.

Types possibles:
- collectee_20 : TVA collectée taux normal 20%
- collectee_10 : TVA collectée taux intermédiaire 10%
- collectee_55 : TVA collectée taux réduit 5,5%
- collectee_21 : TVA collectée taux particulier 2,1%
- collectee_085 : TVA collectée taux super-réduit 0,85%
- deductible_20 : TVA déductible taux normal 20%
- deductible_10 : TVA déductible taux intermédiaire 10%
- deductible_55 : TVA déductible taux réduit 5,5%
- deductible_immo : TVA déductible sur immobilisations
- deductible_intracom : TVA intracommunautaire déductible
- autoliquidation_debit : autoliquidation — débit
- autoliquidation_credit : autoliquidation — crédit
- regularisation : régularisation TVA
- non_deductible : TVA non déductible (véhicules de tourisme, frais de représentation, etc.)
- hors_champ : hors champ TVA (financier, exceptionnel, salaires, etc.)

Réponds UNIQUEMENT avec un JSON valide, sans commentaire:
{"vat_type": "<type>", "confidence": <0.0-1.0>, "reasoning": "<courte explication>"}
"""


@dataclass
class FECEntryInput:
    """Minimal FEC entry data needed for VAT classification."""
    ecriture_num: str
    compte_num: str
    compte_lib: str
    ecriture_lib: str
    debit: float
    credit: float
    journal_code: str = ""
    piece_ref: str = ""


@dataclass
class VATClassificationResult:
    """Result for one FEC entry row."""
    ecriture_num: str
    compte_num: str
    compte_lib: str
    ecriture_lib: str
    debit: float
    credit: float
    vat_type: str
    confidence: float
    method: str       # "rule" or "llm"
    llm_reasoning: Optional[str] = None
    error: Optional[str] = None


class VATClassifier:
    """
    Classify FEC entries by TVA type.

    Parameters
    ----------
    gateway : LLMGateway
        Used for LLM escalation of ambiguous entries.
    dsn : str, optional
        Postgres DSN for persisting results. When absent, only returns in-memory results.
    rules_path : Path, optional
        Override path to pcg_vat_accounts.json.
    """

    def __init__(
        self,
        gateway: LLMGateway,
        dsn: Optional[str] = None,
        rules_path: Optional[Path] = None,
    ) -> None:
        self._gateway = gateway
        self._dsn = dsn
        self._pool: Optional[asyncpg.Pool] = None
        self._rules = RuleEngine(rules_path)

    # ── Public API ─────────────────────────────────────────────────────────────

    async def classify(
        self,
        entries: list[FECEntryInput],
        fec_import_id: str,
        organization_id: Optional[str] = None,
        session_id: str = "default",
    ) -> list[VATClassificationResult]:
        """
        Classify a list of FEC entries.

        Filters to in-scope accounts (44x, 6xx, 7xx) automatically.
        Out-of-scope entries are silently skipped.
        """
        results: list[VATClassificationResult] = []

        deterministic: list[tuple[FECEntryInput, str]] = []
        llm_needed: list[FECEntryInput] = []

        # Step 1: split entries by resolution method
        for entry in entries:
            if not self._rules.is_in_scope(entry.compte_num):
                continue
            vat_type = self._rules.resolve(entry.compte_num)
            if vat_type is not None and vat_type != "ambiguous":
                deterministic.append((entry, vat_type))
            else:
                llm_needed.append(entry)

        # Step 2: collect deterministic results
        for entry, vat_type in deterministic:
            results.append(VATClassificationResult(
                ecriture_num=entry.ecriture_num,
                compte_num=entry.compte_num,
                compte_lib=entry.compte_lib,
                ecriture_lib=entry.ecriture_lib,
                debit=entry.debit,
                credit=entry.credit,
                vat_type=vat_type,
                confidence=1.0,
                method="rule",
            ))

        # Step 3: LLM escalation (sequential to respect rate limits)
        for entry in llm_needed:
            result = await self._classify_with_llm(entry, session_id)
            results.append(result)

        # Step 4: persist to DB (non-fatal)
        await self._persist(results, fec_import_id, organization_id)

        return results

    # ── LLM helper ────────────────────────────────────────────────────────────

    async def _classify_with_llm(
        self,
        entry: FECEntryInput,
        session_id: str,
    ) -> VATClassificationResult:
        prompt = (
            f"Journal: {entry.journal_code}\n"
            f"CompteNum: {entry.compte_num}\n"
            f"CompteLib: {entry.compte_lib}\n"
            f"EcritureLib: {entry.ecriture_lib}\n"
            f"PieceRef: {entry.piece_ref}\n"
            f"Débit: {entry.debit:.2f} | Crédit: {entry.credit:.2f}"
        )
        try:
            response = await self._gateway.complete(
                prompt=prompt,
                system=_LLM_SYSTEM,
                model_hint="classify",
                session_id=session_id,
            )
            parsed = json.loads(response.content)
            vat_type = parsed.get("vat_type", "ambiguous")
            confidence = float(parsed.get("confidence", 0.7))
            reasoning = parsed.get("reasoning", "")
            return VATClassificationResult(
                ecriture_num=entry.ecriture_num,
                compte_num=entry.compte_num,
                compte_lib=entry.compte_lib,
                ecriture_lib=entry.ecriture_lib,
                debit=entry.debit,
                credit=entry.credit,
                vat_type=vat_type,
                confidence=confidence,
                method="llm",
                llm_reasoning=reasoning,
            )
        except Exception as exc:
            logger.error("LLM classify error for %s: %s", entry.compte_num, exc)
            return VATClassificationResult(
                ecriture_num=entry.ecriture_num,
                compte_num=entry.compte_num,
                compte_lib=entry.compte_lib,
                ecriture_lib=entry.ecriture_lib,
                debit=entry.debit,
                credit=entry.credit,
                vat_type="ambiguous",
                confidence=0.0,
                method="llm",
                error=str(exc),
            )

    # ── Persistence ───────────────────────────────────────────────────────────

    async def _ensure_pool(self) -> Optional[asyncpg.Pool]:
        if not self._dsn:
            return None
        if self._pool is None:
            try:
                self._pool = await asyncpg.create_pool(self._dsn)
                await self._pool.execute(_CREATE_TABLE_SQL)
            except Exception as exc:
                logger.error("VATClassifier: failed to create pool: %s", exc)
                self._pool = None
        return self._pool

    async def _persist(
        self,
        results: list[VATClassificationResult],
        fec_import_id: str,
        organization_id: Optional[str],
    ) -> None:
        pool = await self._ensure_pool()
        if pool is None:
            logger.debug("VATClassifier: no DB — skipping persist (%d results)", len(results))
            return

        rows = [
            (
                fec_import_id,
                r.ecriture_num,
                r.compte_num,
                r.compte_lib,
                r.ecriture_lib,
                r.debit,
                r.credit,
                r.vat_type,
                r.confidence,
                r.method,
                r.llm_reasoning,
                organization_id,
            )
            for r in results
        ]
        try:
            await pool.executemany(
                """
                INSERT INTO vat_classifications
                  (fec_import_id, ecriture_num, compte_num, compte_lib, ecriture_lib,
                   debit, credit, vat_type, confidence, method, llm_reasoning, organization_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (fec_import_id, ecriture_num, compte_num) DO UPDATE SET
                  vat_type=EXCLUDED.vat_type, confidence=EXCLUDED.confidence,
                  method=EXCLUDED.method, llm_reasoning=EXCLUDED.llm_reasoning
                """,
                rows,
            )
        except Exception as exc:
            logger.error("VATClassifier: DB write failed: %s", exc)
