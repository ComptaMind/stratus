#!/usr/bin/env python3
"""
Generate a realistic demo FEC file: Cabinet EC Fictif, January 2026, ~5000 entries.

Output: fixtures/FEC_CabinetDupont_202601.txt  (pipe-delimited, UTF-8)

Usage:
    python fixtures/demo_fec_jan2026.py
    python fixtures/demo_fec_jan2026.py --rows 5000 --out my_fec.txt

VAT distribution (realistic for a French mid-size company):
  - 35%  Ventes standard     → TVA collectée 20%  (compte 70x / 706xxx)
  - 15%  Achats biens         → TVA déductible biens 20%  (compte 60x / 601xxx)
  - 20%  Services extérieurs  → TVA déductible services 20%  (compte 62x / 621xxx)
  - 10%  Acquisitions intra.  → TVA autoliquidée (compte 604xxx)
  -  5%  BTP autoliquidation  → autoliquidation TVA  (compte 604xxx label "BTP")
  -  5%  Salaires / charges   → hors champ TVA  (compte 641xxx)
  -  5%  Amortissements       → hors champ  (compte 681xxx)
  -  2%  AMBIGUOUS — mixed label, low confidence  (compte 658xxx)  ← intentional for demo step 4
  -  3%  Compte courant       → non-TVA  (compte 455xxx)
"""
from __future__ import annotations

import argparse
import csv
import io
import random
import sys
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

random.seed(42)

HEADER = [
    "JournalCode", "JournalLib", "EcritureNum", "EcritureDate",
    "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib",
    "PieceRef", "PieceDate", "EcritureLib",
    "Debit", "Credit",
    "LettragePiece", "DateLet", "ValidDate",
    "MontantDevise", "CodeDevise",
]

PERIOD_START = date(2026, 1, 1)
PERIOD_END   = date(2026, 1, 31)

COMPANY      = "Cabinet Dupont & Associés"
SIREN        = "123456789"

# ── Account / scenario catalogue ─────────────────────────────────────────────

SCENARIOS = [
    # (weight, journal, compte, lib_prefix, tva_rate, vat_type_label)
    (35, "VT", "706000", "Honoraires cabinet",       0.20, "collectee_20"),
    (10, "VT", "706100", "Formations dispensées",    0.20, "collectee_20"),
    (10, "AC", "601100", "Fournitures bureau",       0.20, "deductible_biens_20"),
    ( 5, "AC", "601200", "Matériel informatique",    0.20, "deductible_biens_20"),
    (10, "AC", "621000", "Locations logiciels SaaS", 0.20, "deductible_services_20"),
    (10, "AC", "622600", "Honoraires avocats",       0.20, "deductible_services_20"),
    ( 5, "AC", "604100", "Acquisition UE - logiciel",0.20, "intracom_acquisition"),
    ( 5, "AC", "604200", "Travaux BTP autoliq.",     0.20, "autoliquidation_btp"),
    ( 5, "PA", "641000", "Salaires bruts",           0.00, "hors_champ"),
    ( 5, "OD", "681110", "Dot. amort. matériel",     0.00, "hors_champ"),
    # Ambiguous — intentionally unclear for demo step 4/5
    ( 1, "AC", "658100", "Divers exploit. (mixte)",  0.20, "ambiguous"),
    ( 1, "AC", "658200", "Pénalités (ambigu TVA)",   0.20, "ambiguous"),
    # Non-TVA
    ( 3, "BQ", "455000", "Compte courant assoc.",   0.00, "non_deductible"),
]

# Normalize weights
_total_weight = sum(s[0] for s in SCENARIOS)
SCENARIOS_NORM = [(s[0] / _total_weight, *s[1:]) for s in SCENARIOS]


def random_date(start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, delta))


def fmt_amount(v: float) -> str:
    return str(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)).replace(".", ",")


def generate_fec(n_rows: int) -> list[list[str]]:
    rows: list[list[str]] = []
    seq = 1

    for _ in range(n_rows // 2):  # each scenario generates 2 lines (debit + counterpart)
        # Pick scenario
        r = random.random()
        cumul = 0.0
        chosen = SCENARIOS_NORM[-1]
        for s in SCENARIOS_NORM:
            cumul += s[0]
            if r <= cumul:
                chosen = s
                break

        _, journal, compte, lib_prefix, tva_rate, _ = chosen
        ht = round(random.uniform(50, 15000), 2)
        tva = round(ht * tva_rate, 2)
        ttc = round(ht + tva, 2)

        d = random_date(PERIOD_START, PERIOD_END)
        date_str = d.strftime("%Y%m%d")
        num = f"ECR{seq:06d}"
        piece = f"PJ{seq:06d}"
        lib = f"{lib_prefix} — {d.strftime('%d/%m')}"
        seq += 1

        if tva_rate > 0:
            # Line 1: charge / product account
            rows.append([
                journal, lib_prefix, num, date_str,
                compte, lib_prefix, "", "",
                piece, date_str, lib,
                fmt_amount(ht), "0,00",
                "", "", date_str, "", "",
            ])
            # Line 2: TVA account
            tva_compte = "44566000" if "deductible" in _ or journal == "AC" else "44571000"
            # pick correct TVA compte based on journal
            if journal == "AC":
                tva_compte = "44566000"  # TVA déductible
            elif journal == "VT":
                tva_compte = "44571000"  # TVA collectée
            else:
                tva_compte = "44567000"  # autoliquidée

            rows.append([
                journal, lib_prefix, f"ECR{seq:06d}", date_str,
                tva_compte, "TVA", "", "",
                piece, date_str, f"TVA — {lib}",
                fmt_amount(tva), "0,00",
                "", "", date_str, "", "",
            ])
            seq += 1

            # Counterpart (411 / 401 / 512)
            if journal == "VT":
                cpt_compte = "411000"
                rows.append([
                    journal, lib_prefix, f"ECR{seq:06d}", date_str,
                    cpt_compte, "Client", "", "",
                    piece, date_str, lib,
                    "0,00", fmt_amount(ttc),
                    "", "", date_str, "", "",
                ])
            else:
                cpt_compte = "401000"
                rows.append([
                    journal, lib_prefix, f"ECR{seq:06d}", date_str,
                    cpt_compte, "Fournisseur", "", "",
                    piece, date_str, lib,
                    "0,00", fmt_amount(ttc),
                    "", "", date_str, "", "",
                ])
            seq += 1
        else:
            # Simple two-line entry (no TVA)
            rows.append([
                journal, lib_prefix, num, date_str,
                compte, lib_prefix, "", "",
                piece, date_str, lib,
                fmt_amount(ht), "0,00",
                "", "", date_str, "", "",
            ])
            rows.append([
                journal, lib_prefix, f"ECR{seq:06d}", date_str,
                "512000", "Banque", "", "",
                piece, date_str, lib,
                "0,00", fmt_amount(ht),
                "", "", date_str, "", "",
            ])
            seq += 1

    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate demo FEC file")
    parser.add_argument("--rows", type=int, default=5000, help="Target row count (default 5000)")
    parser.add_argument("--out", type=str, default=None, help="Output path")
    args = parser.parse_args()

    out_dir  = Path(__file__).parent
    out_path = Path(args.out) if args.out else out_dir / "FEC_CabinetDupont_202601.txt"

    rows = generate_fec(args.rows)

    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, delimiter="|")
        writer.writerow(HEADER)
        writer.writerows(rows)

    print(f"Generated {len(rows)} FEC entries → {out_path}")
    print(f"Period: {PERIOD_START} → {PERIOD_END}")
    print(f"Company: {COMPANY} (SIREN {SIREN})")
    print(f"\nTo use in demo:")
    print(f"  1. Dashboard → Cabinet Dupont → Imports tab → Upload FEC → select {out_path.name}")
    print(f"  2. Click 'Classify' → wait ~60s")
    print(f"  3. Open Chat → 'Compute CA3 for January 2026'")
    print(f"  4. The agent will flag 2 ambiguous entries (658100, 658200)")
    print(f"  5. Ask: 'Show me your reasoning on line 16'")


if __name__ == "__main__":
    main()
