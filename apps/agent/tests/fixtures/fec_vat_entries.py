"""
20 FEC entry fixtures for VAT classifier tests.

Design:
  - 16 entries resolvable deterministically by the rule engine (method='rule')
  - 4 entries that are ambiguous and require LLM (marked ambiguous=True)

All amounts balanced per pair (for reference only — classifier works per-entry).
"""
from __future__ import annotations

from src.classifier.vat_classifier import FECEntryInput

# Deterministic entries (16)
DETERMINISTIC_ENTRIES: list[FECEntryInput] = [
    # ── 44564 — TVA déductible 20% (achats)
    FECEntryInput(
        ecriture_num="A001", compte_num="44564000",
        compte_lib="État - TVA déductible sur biens et services",
        ecriture_lib="Achat fournitures - TVA", debit=200.0, credit=0.0
    ),
    # ── 44551 — TVA collectée 20% (ventes)
    FECEntryInput(
        ecriture_num="A002", compte_num="44551000",
        compte_lib="État - TVA collectée 20%",
        ecriture_lib="Vente prestation TVA 20%", debit=0.0, credit=400.0
    ),
    # ── 44566 — TVA déductible 5,5%
    FECEntryInput(
        ecriture_num="A003", compte_num="44566000",
        compte_lib="État - TVA déductible 5,5%",
        ecriture_lib="Achat alimentation TVA 5.5%", debit=55.0, credit=0.0
    ),
    # ── 44552 — TVA collectée 10%
    FECEntryInput(
        ecriture_num="A004", compte_num="44552000",
        compte_lib="État - TVA collectée 10%",
        ecriture_lib="Prestation restauration TVA 10%", debit=0.0, credit=150.0
    ),
    # ── 44571 — TVA collectée à décaisser
    FECEntryInput(
        ecriture_num="A005", compte_num="44571000",
        compte_lib="État - TVA à décaisser",
        ecriture_lib="Règlement TVA mensuelle", debit=0.0, credit=800.0
    ),
    # ── 44562 — TVA déductible sur immobilisations
    FECEntryInput(
        ecriture_num="A006", compte_num="44562000",
        compte_lib="État - TVA déductible immobilisations",
        ecriture_lib="Achat matériel informatique TVA", debit=600.0, credit=0.0
    ),
    # ── 44563 — TVA intracommunautaire déductible
    FECEntryInput(
        ecriture_num="A007", compte_num="44563000",
        compte_lib="TVA intracommunautaire déductible",
        ecriture_lib="Acquisition UE autoliquidation", debit=300.0, credit=0.0
    ),
    # ── 44581 — Autoliquidation débit
    FECEntryInput(
        ecriture_num="A008", compte_num="44581000",
        compte_lib="TVA autoliquidée débit",
        ecriture_lib="Sous-traitance BTP autoliquidation", debit=500.0, credit=0.0
    ),
    # ── 4458 prefix → regularisation
    FECEntryInput(
        ecriture_num="A009", compte_num="44580000",
        compte_lib="TVA à régulariser",
        ecriture_lib="Régularisation TVA clôture", debit=120.0, credit=0.0
    ),
    # ── 60100000 — Achats matières premières → deductible_20
    FECEntryInput(
        ecriture_num="A010", compte_num="60100000",
        compte_lib="Achats matières premières",
        ecriture_lib="Achat MP fournisseur", debit=1000.0, credit=0.0
    ),
    # ── 60600000 — Achats non stockés → deductible_20
    FECEntryInput(
        ecriture_num="A011", compte_num="60600000",
        compte_lib="Achats non stockés - fournitures bureau",
        ecriture_lib="Fournitures bureau", debit=150.0, credit=0.0
    ),
    # ── 61300000 — Locations → non_deductible check (not in nded set → deductible_20)
    FECEntryInput(
        ecriture_num="A012", compte_num="61300000",
        compte_lib="Locations immobilières",
        ecriture_lib="Loyer mensuel", debit=2000.0, credit=0.0
    ),
    # ── 62500000 — Déplacements → deductible_20
    FECEntryInput(
        ecriture_num="A013", compte_num="62500000",
        compte_lib="Déplacements et missions",
        ecriture_lib="Note de frais déplacement", debit=350.0, credit=0.0
    ),
    # ── 70600000 — Prestations de services → collectee_20
    FECEntryInput(
        ecriture_num="A014", compte_num="70600000",
        compte_lib="Prestations de services",
        ecriture_lib="Facture client prestation", debit=0.0, credit=5000.0
    ),
    # ── 66100000 — Intérêts bancaires → hors_champ
    FECEntryInput(
        ecriture_num="A015", compte_num="66100000",
        compte_lib="Intérêts des emprunts",
        ecriture_lib="Intérêts emprunt banque", debit=450.0, credit=0.0
    ),
    # ── 75000000 — Produits financiers → hors_champ
    FECEntryInput(
        ecriture_num="A016", compte_num="75000000",
        compte_lib="Produits de participation",
        ecriture_lib="Dividendes reçus", debit=0.0, credit=1200.0
    ),
]

# LLM-escalation entries (4 — ambiguous or unknown)
LLM_ENTRIES: list[FECEntryInput] = [
    # ── 63500000 — Impôts et taxes : non_deductible for 6355 (patente) but base 6350 is ambiguous
    FECEntryInput(
        ecriture_num="B001", compte_num="63500000",
        compte_lib="Impôts locaux - CFE",
        ecriture_lib="Cotisation foncière entreprises", debit=800.0, credit=0.0,
        journal_code="AC"
    ),
    # ── 62300000 — Publicité / communication : deductible_20 normally but some non-ded
    FECEntryInput(
        ecriture_num="B002", compte_num="62300000",
        compte_lib="Publicité, publications, relations publiques",
        ecriture_lib="Cadeaux clients", debit=250.0, credit=0.0,
        journal_code="AC"
    ),
    # ── 64700000 — Charges sociales patronales : hors_champ normally
    FECEntryInput(
        ecriture_num="B003", compte_num="64700000",
        compte_lib="Autres charges sociales",
        ecriture_lib="Cotisations sociales dirigeant", debit=1500.0, credit=0.0,
        journal_code="OD"
    ),
    # ── 79800000 — Transferts de charges : ambiguous
    FECEntryInput(
        ecriture_num="B004", compte_num="79800000",
        compte_lib="Transferts de charges d'exploitation",
        ecriture_lib="Refacturation charges groupe", debit=0.0, credit=600.0,
        journal_code="OD"
    ),
]

ALL_ENTRIES: list[FECEntryInput] = DETERMINISTIC_ENTRIES + LLM_ENTRIES

# Expected VAT types for deterministic entries (index-aligned with DETERMINISTIC_ENTRIES)
EXPECTED_VAT_TYPES: list[str] = [
    "deductible_20",       # A001 44564000
    "collectee_20",        # A002 44551000
    "deductible_55",       # A003 44566000
    "collectee_10",        # A004 44552000
    "collectee_20",        # A005 44571000
    "deductible_immo",     # A006 44562000
    "deductible_intracom", # A007 44563000
    "autoliquidation_debit",  # A008 44581000
    "regularisation",      # A009 44580000
    "deductible_20",       # A010 60100000
    "deductible_20",       # A011 60600000
    "deductible_20",       # A012 61300000
    "deductible_20",       # A013 62500000
    "collectee_20",        # A014 70600000
    "hors_champ",          # A015 66100000
    "hors_champ",          # A016 75000000
]
