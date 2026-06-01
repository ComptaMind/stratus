#!/usr/bin/env python3
"""
DGFiP EDI-TVA Sandbox Upload Script — Stratus MVP.

Generates a CA3 declaration XML and submits it to the DGFiP TDFC test
environment (EDI sandbox), then prints the receipt.

Usage
-----
  cd stratus/
  python scripts/test_dgfip_sandbox.py \\
      --siret 12345678901234 \\
      --raison-sociale "Ma Société SARL" \\
      --period-start 2025-01-01 \\
      --period-end   2025-01-31 \\
      [--dry-run]    # Generate XML but don't submit

Environment variables
---------------------
  DGFIP_SANDBOX_URL   Override sandbox endpoint (default: env test URL)
  DGFIP_PARTNER_ID    EDI partner identifier (EDI intermediary code)
  DGFIP_SECRET_TOKEN  Bearer token for DGFiP sandbox auth (if required)

Notes
-----
  - DGFiP TDFC sandbox credentials require registration at
    https://www.impots.gouv.fr/professionnel/edi-tva (EDI partenaire).
  - For MVP: manual upload via Espace EC is recommended after reviewing
    the generated XML.  Auto-submission is planned for V1.
  - If the sandbox endpoint returns 4xx/5xx, the raw response body
    is printed so you can diagnose schema or authentication issues.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

# ── Resolve repo root and add to path ─────────────────────────────────────────

_REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_REPO_ROOT / "apps" / "agent"))

from src.declarations.ca3_engine import CA3Declaration, CA3Lines
from src.declarations.edi_tva_generator import (
    EDIValidationError,
    FiscalClientInfo,
    generate_edi_tva_xml,
)

# ── DGFiP TDFC sandbox endpoint ───────────────────────────────────────────────
# The official sandbox URL is provided by DGFiP to registered EDI partners.
# Replace with the URL from your EDI partenaire agreement.
_DEFAULT_SANDBOX_URL = os.getenv(
    "DGFIP_SANDBOX_URL",
    "https://preprod-efi.impots.gouv.fr/tdt/depot",
)


# ── Synthetic test declaration ─────────────────────────────────────────────────


def _build_test_declaration(
    fiscal_client_id: str,
    period_start: date,
    period_end: date,
    period_type: str,
) -> CA3Declaration:
    """
    Build a minimal CA3 declaration for sandbox testing.

    Uses small but realistic amounts (20 % TVA, 1 000 € base HT).
    Not suitable for production — replace with compute_ca3() output.
    """
    lines = CA3Lines(
        A1=Decimal("1000.00"),
        L08=Decimal("1000.00"),
        L16=Decimal("200.00"),
        L15=Decimal("200.00"),
        L20=Decimal("50.00"),
        L22=Decimal("50.00"),
        L24=Decimal("150.00"),
    )
    return CA3Declaration(
        fiscal_client_id=fiscal_client_id,
        period_start=period_start,
        period_end=period_end,
        period_type=period_type,
        org_id="sandbox-test",
        lines=lines,
        validation_issues=[],
        engine_version="ca3-v1.0",
        entries_count=2,
        ambiguous_count=0,
    )


# ── Submission ────────────────────────────────────────────────────────────────


def submit_to_sandbox(xml_bytes: bytes, sandbox_url: str) -> dict:
    """
    POST the EDI-TVA XML to the DGFiP sandbox and return the response.

    Returns a dict with keys: status_code, body, success.
    """
    try:
        import urllib.request
        import urllib.error

        token = os.getenv("DGFIP_PARTNER_TOKEN", "")
        partner_id = os.getenv("DGFIP_PARTNER_ID", "STRATUS-BETA")

        headers = {
            "Content-Type": "application/xml;charset=UTF-8",
            "X-Partner-Id": partner_id,
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        req = urllib.request.Request(
            sandbox_url,
            data=xml_bytes,
            headers=headers,
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return {"status_code": resp.status, "body": body, "success": True}

    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        return {"status_code": exc.code, "body": body, "success": False}
    except Exception as exc:
        return {"status_code": 0, "body": str(exc), "success": False}


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate and submit EDI-TVA CA3 XML to DGFiP sandbox"
    )
    parser.add_argument("--siret", required=True, help="14-digit SIRET of declaring entity")
    parser.add_argument("--raison-sociale", required=True, help="Legal name of declaring entity")
    parser.add_argument("--period-start", required=True, help="Period start date YYYY-MM-DD")
    parser.add_argument("--period-end",   required=True, help="Period end date YYYY-MM-DD")
    parser.add_argument(
        "--period-type",
        choices=["mensuelle", "trimestrielle"],
        default="mensuelle",
    )
    parser.add_argument(
        "--output", "-o",
        help="Save generated XML to this file path (optional)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate XML but do not submit to sandbox",
    )
    parser.add_argument(
        "--sandbox-url",
        default=_DEFAULT_SANDBOX_URL,
        help="DGFiP TDFC sandbox endpoint URL",
    )
    parser.add_argument(
        "--intent",
        choices=["LIQ", "RECT", "TEST"],
        default="TEST",
        help="DacIntent value (default: TEST for sandbox runs)",
    )
    args = parser.parse_args()

    # ── Parse dates ───────────────────────────────────────────────────────────
    try:
        period_start = date.fromisoformat(args.period_start)
        period_end   = date.fromisoformat(args.period_end)
    except ValueError as exc:
        print(f"[ERROR] Invalid date: {exc}", file=sys.stderr)
        return 1

    # ── Build client info ──────────────────────────────────────────────────────
    try:
        client_info = FiscalClientInfo(
            siret=args.siret,
            raison_sociale=args.raison_sociale,
            regime_tva=args.period_type,
        )
    except ValueError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    # ── Build declaration ──────────────────────────────────────────────────────
    fiscal_client_id = f"{args.siret}-sandbox"
    declaration = _build_test_declaration(
        fiscal_client_id=fiscal_client_id,
        period_start=period_start,
        period_end=period_end,
        period_type=args.period_type,
    )

    # ── Generate XML ───────────────────────────────────────────────────────────
    print("[INFO] Generating EDI-TVA XML…")
    try:
        xml_bytes, sha256_hex = generate_edi_tva_xml(
            declaration,
            client_info=client_info,
            intent=args.intent,
        )
    except EDIValidationError as exc:
        print(f"[ERROR] XSD validation failed: {exc}", file=sys.stderr)
        for err in exc.errors:
            print(f"         {err}", file=sys.stderr)
        return 1

    print(f"[INFO] XML generated: {len(xml_bytes):,} bytes")
    print(f"[INFO] SHA-256: {sha256_hex}")

    # ── Save to file if requested ──────────────────────────────────────────────
    if args.output:
        Path(args.output).write_bytes(xml_bytes)
        print(f"[INFO] Saved to: {args.output}")

    # ── Dry-run: print and exit ────────────────────────────────────────────────
    if args.dry_run:
        print("\n[DRY-RUN] XML content:")
        print("─" * 60)
        print(xml_bytes.decode("utf-8"))
        print("─" * 60)
        print("[DRY-RUN] No submission performed.")
        return 0

    # ── Submit to sandbox ──────────────────────────────────────────────────────
    print(f"[INFO] Submitting to sandbox: {args.sandbox_url}")
    result = submit_to_sandbox(xml_bytes, args.sandbox_url)

    print(f"[INFO] HTTP status: {result['status_code']}")
    print(f"[INFO] Response body:")
    print("─" * 60)
    print(result["body"] or "(empty)")
    print("─" * 60)

    if result["success"]:
        print("[OK] Sandbox submission accepted.")
        return 0
    else:
        print(f"[ERROR] Sandbox submission failed (HTTP {result['status_code']}).")
        print("[NOTE] Common causes:")
        print("  - DGFIP_PARTNER_ID / DGFIP_PARTNER_TOKEN not set")
        print("  - Sandbox not reachable (requires DGFiP EDI partenaire registration)")
        print("  - XSD schema version mismatch")
        return 1


if __name__ == "__main__":
    sys.exit(main())
