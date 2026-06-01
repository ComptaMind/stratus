"""
Deterministic VAT rule engine based on the PCG français.

Resolution order
----------------
1. Exact match on CompteNum in the 44x mapping.
2. Longest-prefix match in the prefix list (sorted desc by length).
3. Charge/product account heuristics for 6xx/7xx.
4. Returns None → caller must escalate to LLM.

VAT types returned
------------------
  collectee_20 | collectee_10 | collectee_55 | collectee_21 | collectee_085
  deductible_20 | deductible_10 | deductible_55 | deductible_immo | deductible_intracom
  autoliquidation_debit | autoliquidation_credit
  regularisation | non_deductible | hors_champ | ambiguous
  None  →  escalate to LLM
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_RULES_PATH = Path(__file__).parent.parent.parent / "docs" / "pcg_vat_accounts.json"


class RuleEngine:
    """
    Load PCG VAT mapping from JSON and resolve a compte number to a VAT type.

    Parameters
    ----------
    rules_path : Path, optional
        Override the default docs/pcg_vat_accounts.json location.
    """

    def __init__(self, rules_path: Optional[Path] = None) -> None:
        path = rules_path or _RULES_PATH
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)

        self._exact: dict[str, str] = data["exact"]
        # Sort prefix list longest-first so the first match is always most specific.
        self._prefix: list[tuple[str, str]] = sorted(
            [(p["prefix"], p["vat_type"]) for p in data["prefix"]],
            key=lambda t: len(t[0]),
            reverse=True,
        )
        # Charge / product account lookup sets
        charge = data["charge_accounts"]
        self._charge_ded20: set[str] = set(charge["deductible_20"])
        self._charge_nded: set[str] = set(charge["non_deductible"])
        self._charge_hors: set[str] = set(charge["hors_champ"])
        product = data["product_accounts"]
        self._prod_col20: set[str] = set(product["collectee_20"])
        self._prod_hors: set[str] = set(product["hors_champ"])

    # ── Public API ─────────────────────────────────────────────────────────────

    def resolve(self, compte_num: str) -> Optional[str]:
        """
        Return VAT type string or None (= LLM escalation required).

        Parameters
        ----------
        compte_num : str
            CompteNum from FEC (e.g. "44564", "60100000", "70100").
        """
        compte = compte_num.strip()

        # 1 — Direct 44x lookup
        if compte.startswith("44") or compte.startswith("445"):
            result = self._resolve_44x(compte)
            if result is not None:
                return result

        # 2 — Charge accounts 6xx
        if compte.startswith("6"):
            return self._resolve_6xx(compte)

        # 3 — Product accounts 7xx
        if compte.startswith("7"):
            return self._resolve_7xx(compte)

        # Unknown account class — not in scope
        return None

    def is_in_scope(self, compte_num: str) -> bool:
        """Return True if this account is potentially TVA-relevant."""
        c = compte_num.strip()
        return c.startswith("44") or c.startswith("6") or c.startswith("7")

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _resolve_44x(self, compte: str) -> Optional[str]:
        # Exact match first
        if compte in self._exact:
            return self._exact[compte]
        # Longest-prefix match
        for prefix, vat_type in self._prefix:
            if compte.startswith(prefix):
                return vat_type
        return None

    def _resolve_6xx(self, compte: str) -> Optional[str]:
        # Exact non-deductible check (longest prefix first already embedded)
        for code in self._charge_nded:
            if compte.startswith(code):
                return "non_deductible"
        # Hors-champ (financial charges etc.)
        for code in self._charge_hors:
            if compte.startswith(code):
                return "hors_champ"
        # Deductible 20% standard
        for code in self._charge_ded20:
            if compte.startswith(code):
                return "deductible_20"
        # Unknown 6xx — needs LLM
        return None

    def _resolve_7xx(self, compte: str) -> Optional[str]:
        # Hors-champ first (financial income, exceptional, etc.)
        for code in self._prod_hors:
            if compte.startswith(code):
                return "hors_champ"
        # Standard VAT-liable revenue
        for code in self._prod_col20:
            if compte.startswith(code):
                return "collectee_20"
        # Unknown 7xx — needs LLM
        return None
