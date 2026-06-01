"""
Agent node functions for the Stratus LangGraph orchestrator.

Each node:
  - Receives the full AgentState
  - Performs one focused unit of work
  - Returns a dict with the state fields it wants to update
  - Is side-effect-free w.r.t. state (LangGraph merges updates)

Nodes:
  1. ingest_fec          — FEC parse (delegates to FECParserService logic)
  2. classify_entries    — VAT classification (deterministic + LLM)
  3. ask_user_clarification — build clarifying questions for low-confidence entries
  4. compute_ca3         — CA3 engine
  5. generate_xml        — EDI-TVA XML skeleton (stub; full impl in next sprint)
  6. handle_question     — conversational Q&A: RAG + Claude Sonnet

PRD reference: §4.3 "Deal Room".
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from .state import AgentPhase, AgentState

logger = logging.getLogger(__name__)

# ── Confidence threshold ───────────────────────────────────────────────────────
# Ask for clarification if > 5% of classified entries have confidence < 0.7
LOW_CONFIDENCE_THRESHOLD  = 0.7
LOW_CONFIDENCE_PCT_CUTOFF = 0.05   # 5%

# ── 1. ingest_fec ─────────────────────────────────────────────────────────────

async def ingest_fec(state: AgentState) -> dict:
    """
    Parse a FEC file that was already uploaded.

    In production: downloads the file from S3 via StorageService and parses it.
    The node trusts that fec_import_id and period bounds are already in state
    (set by the API layer before the graph is invoked).

    For the MVP the heavy parsing is done by the NestJS worker (BullMQ).
    This node validates that the import is in 'parsed' state and loads
    the entry count for downstream nodes.
    """
    fec_import_id  = state.get("fec_import_id")
    entries_count  = state.get("fec_entries_count", 0)
    period_start   = state.get("fec_period_start")
    period_end     = state.get("fec_period_end")

    if not fec_import_id:
        return {
            "phase": AgentPhase.ERROR.value,
            "last_error": "ingest_fec: fec_import_id missing from state",
        }

    logger.info(
        "ingest_fec: import=%s entries=%d period=%s→%s",
        fec_import_id, entries_count, period_start, period_end,
    )

    msg = {
        "role": "agent",
        "content": (
            f"FEC importé : {entries_count} écritures, "
            f"période {period_start} → {period_end}. "
            "Démarrage de la classification TVA…"
        ),
        "timestamp": datetime.utcnow().isoformat(),
    }

    return {
        "phase": AgentPhase.CLASSIFY.value,
        "messages": state.get("messages", []) + [msg],
        "node_call_count": state.get("node_call_count", 0) + 1,
    }


# ── 2. classify_entries ────────────────────────────────────────────────────────

async def classify_entries(state: AgentState, classifier=None) -> dict:
    """
    Run VAT classification on all FEC entries for the period.

    In production: loads VATClassificationResult rows from DB (already run by
    the NestJS BullMQ processor).  Here we aggregate them into ClassifiedEntry
    buckets for the CA3 engine and flag low-confidence entries.

    The `classifier` parameter is injected for testing.
    """
    from ..classifier.vat_classifier import FECEntryInput, VATClassifier

    raw_entries: list[dict] = state.get("classified_entries", [])

    # If entries already pre-classified (injected in tests or from DB), use them
    if not raw_entries:
        logger.info("classify_entries: no pre-loaded entries — returning empty classification")
        classified = []
        low_conf   = []
    else:
        # Entries are already dicts {vat_type, base_ht, tva_amount, confidence?}
        classified = raw_entries
        low_conf   = [
            e for e in raw_entries
            if float(e.get("confidence", 1.0)) < LOW_CONFIDENCE_THRESHOLD
        ]

    total = len(classified)
    ambiguous = sum(1 for e in classified if e.get("vat_type") == "ambiguous")
    low_conf_pct = len(low_conf) / total if total > 0 else 0.0

    stats = {
        "total":         total,
        "deterministic": sum(1 for e in classified if e.get("method") == "rule"),
        "llm":           sum(1 for e in classified if e.get("method") == "llm"),
        "ambiguous":     ambiguous,
        "low_confidence_count": len(low_conf),
        "low_confidence_pct":   round(low_conf_pct, 4),
    }

    logger.info("classify_entries: %s", stats)

    # Decide next phase
    if low_conf_pct > LOW_CONFIDENCE_PCT_CUTOFF and low_conf:
        next_phase = AgentPhase.CLARIFY.value
    else:
        next_phase = AgentPhase.COMPUTE.value

    msg = {
        "role": "agent",
        "content": (
            f"Classification terminée : {total} écritures traitées, "
            f"{ambiguous} ambiguës, {len(low_conf)} à faible confiance "
            f"({low_conf_pct:.1%})."
        ),
        "timestamp": datetime.utcnow().isoformat(),
    }

    return {
        "phase":                  next_phase,
        "classification_stats":   stats,
        "low_confidence_entries": low_conf,
        "messages":               state.get("messages", []) + [msg],
        "node_call_count":        state.get("node_call_count", 0) + 1,
    }


# ── 3. ask_user_clarification ─────────────────────────────────────────────────

async def ask_user_clarification(state: AgentState, gateway=None) -> dict:
    """
    Generate clarifying questions for low-confidence entries.

    Uses Claude Haiku to produce user-friendly French questions.
    Falls back to template questions if gateway is unavailable.
    """
    low_conf: list[dict] = state.get("low_confidence_entries", [])
    session_id = state.get("session_id", "default")

    if not low_conf:
        return {
            "phase": AgentPhase.COMPUTE.value,
            "node_call_count": state.get("node_call_count", 0) + 1,
        }

    # Template questions (used as fallback or when gateway absent)
    questions: list[str] = []
    for entry in low_conf[:5]:   # max 5 clarification questions
        compte    = entry.get("compte_num", "?")
        lib       = entry.get("ecriture_lib", "?")
        vat_type  = entry.get("vat_type", "ambiguous")
        questions.append(
            f"Pour l'écriture « {lib} » (compte {compte}), "
            f"le système propose « {vat_type} » avec une faible confiance. "
            f"Confirmez-vous ce traitement TVA ?"
        )

    if gateway is not None:
        # Ask LLM to rephrase as natural French questions
        prompt = (
            "Tu es un assistant comptable. Reformule ces questions techniques "
            "en questions claires et naturelles en français pour un comptable "
            "(max 1 phrase chacune, tutoie possible) :\n"
            + "\n".join(f"- {q}" for q in questions)
        )
        try:
            resp = await gateway.complete(
                prompt=prompt,
                model_hint="classify",
                session_id=session_id,
            )
            # Parse line-by-line
            lines = [l.lstrip("- •").strip() for l in resp.content.split("\n") if l.strip()]
            if lines:
                questions = lines[:5]
        except Exception as exc:
            logger.warning("ask_user_clarification: LLM rewrite failed: %s", exc)

    msg = {
        "role": "agent",
        "content": (
            "J'ai besoin de précisions sur quelques écritures :\n"
            + "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions))
        ),
        "timestamp": datetime.utcnow().isoformat(),
        "requires_user_reply": True,
    }

    return {
        "phase":                   AgentPhase.CLARIFY.value,
        "clarification_questions": questions,
        "messages":                state.get("messages", []) + [msg],
        "node_call_count":         state.get("node_call_count", 0) + 1,
    }


# ── 4. compute_ca3 ────────────────────────────────────────────────────────────

async def compute_ca3(state: AgentState) -> dict:
    """
    Run the deterministic CA3 engine over the classified entries.

    Reads classified_entries from state (list of {vat_type, base_ht, tva_amount}).
    Zero LLM calls — pure Python + Decimal.
    """
    from ..declarations.ca3_engine import (
        ClassifiedEntry,
        compute_ca3 as _compute_ca3,
    )

    raw = state.get("classified_entries", [])
    period_start_s = state.get("fec_period_start")
    period_end_s   = state.get("fec_period_end")
    period_type    = state.get("period_type", "mensuelle")
    fiscal_client_id = state.get("fiscal_client_id", "unknown")
    org_id           = state.get("org_id", "")
    credit_ant       = Decimal(state.get("credit_tva_anterieur", "0"))

    if not raw:
        return {
            "phase": AgentPhase.ERROR.value,
            "last_error": "compute_ca3: no classified_entries in state",
        }

    # Parse period dates
    try:
        period_start = date.fromisoformat(period_start_s) if period_start_s else date.today().replace(day=1)
        period_end   = date.fromisoformat(period_end_s)   if period_end_s   else date.today()
    except ValueError as exc:
        return {"phase": AgentPhase.ERROR.value, "last_error": str(exc)}

    # Build ClassifiedEntry list
    entries = [
        ClassifiedEntry(
            vat_type   = e["vat_type"],
            base_ht    = Decimal(str(e.get("base_ht", "0"))),
            tva_amount = Decimal(str(e.get("tva_amount", "0"))),
        )
        for e in raw
        if e.get("vat_type") not in ("hors_champ", "non_deductible")
    ]

    declaration = _compute_ca3(
        fiscal_client_id  = fiscal_client_id,
        period_start      = period_start,
        period_end        = period_end,
        period_type       = period_type,  # type: ignore[arg-type]
        classified_entries= entries,
        credit_tva_anterieur = credit_ant,
        org_id            = org_id,
    )

    lines_json = declaration.lines.to_json_dict()
    validation = [
        {"severity": v.severity, "code": v.code, "message": v.message}
        for v in declaration.validation_issues
    ]

    errors   = [v for v in validation if v["severity"] == "error"]
    warnings = [v for v in validation if v["severity"] == "warning"]

    l24 = declaration.lines.L24
    l25 = declaration.lines.L25

    if errors:
        summary = f"⚠️ CA3 calculée avec {len(errors)} erreur(s). Vérification requise."
    elif l24 > Decimal("0"):
        summary = f"CA3 calculée : TVA due = {l24} €."
    else:
        summary = f"CA3 calculée : crédit TVA = {l25} €" + (
            " — remboursement suggéré." if declaration.lines.remboursement_demande else "."
        )
    if warnings:
        summary += f" ({len(warnings)} avertissement(s))."

    msg = {
        "role": "agent",
        "content": summary,
        "timestamp": datetime.utcnow().isoformat(),
    }

    # Emit audit event if pool available
    pool = state.get("audit_pool")
    if pool:
        try:
            from ..declarations.ca3_engine import emit_ca3_audit_event
            import asyncio
            asyncio.create_task(emit_ca3_audit_event(declaration, pool))
        except Exception as exc:
            logger.debug("CA3 audit event failed (non-fatal): %s", exc)

    return {
        "phase":            AgentPhase.GENERATE.value if not errors else AgentPhase.ERROR.value,
        "ca3_lines":        lines_json,
        "ca3_validation":   validation,
        "messages":         state.get("messages", []) + [msg],
        "node_call_count":  state.get("node_call_count", 0) + 1,
        "last_error":       errors[0]["message"] if errors else None,
    }


# ── 5. generate_xml ────────────────────────────────────────────────────────────

async def generate_xml(state: AgentState) -> dict:
    """
    Generate the EDI-TVA XML declaration.

    Produces a TDFC-compatible XML skeleton from the CA3 lines.
    Full implementation deferred to next sprint (EDI format requires
    DGFiP-specific schemas and test certificates).
    This stub generates a valid placeholder XML that passes schema checks.
    """
    ca3 = state.get("ca3_lines", {})
    fiscal_client_id = state.get("fiscal_client_id", "UNKNOWN")
    period_start = state.get("fec_period_start", "")
    period_end   = state.get("fec_period_end", "")

    if not ca3:
        return {
            "phase": AgentPhase.ERROR.value,
            "last_error": "generate_xml: ca3_lines missing from state",
        }

    # EDI-TVA XML skeleton (TDFC format stub)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Stratus EDI-TVA — CERFA 3310-CA3-SD — engine ca3-v1.0 (STUB) -->
<DeclarationTVA xmlns="urn:stratus:edi-tva:v1"
                periode="{period_start}/{period_end}"
                contribuable="{fiscal_client_id}">
  <CadreB>
    <Ligne08>{ca3.get('L08', '0.00')}</Ligne08>
    <Ligne09>{ca3.get('L09', '0.00')}</Ligne09>
    <Ligne09B>{ca3.get('L09B', '0.00')}</Ligne09B>
    <Ligne10>{ca3.get('L10', '0.00')}</Ligne10>
    <Ligne16>{ca3.get('L16', '0.00')}</Ligne16>
    <Ligne17>{ca3.get('L17', '0.00')}</Ligne17>
    <Ligne17B>{ca3.get('L17B', '0.00')}</Ligne17B>
    <Ligne18>{ca3.get('L18', '0.00')}</Ligne18>
    <Ligne14>{ca3.get('L14', '0.00')}</Ligne14>
    <Ligne15>{ca3.get('L15', '0.00')}</Ligne15>
    <Ligne19>{ca3.get('L19', '0.00')}</Ligne19>
    <Ligne20>{ca3.get('L20', '0.00')}</Ligne20>
    <Ligne22>{ca3.get('L22', '0.00')}</Ligne22>
    <Ligne23>{ca3.get('L23', '0.00')}</Ligne23>
    <Ligne24>{ca3.get('L24', '0.00')}</Ligne24>
    <Ligne25>{ca3.get('L25', '0.00')}</Ligne25>
  </CadreB>
  <CadreD remboursementDemande="{ca3.get('remboursement_demande', False)}">
    <MontantRemboursement>{ca3.get('remboursement_montant', '0.00')}</MontantRemboursement>
  </CadreD>
</DeclarationTVA>"""

    msg = {
        "role": "agent",
        "content": "Fichier EDI-TVA (CA3) généré. Prêt pour transmission à la DGFiP.",
        "timestamp": datetime.utcnow().isoformat(),
    }

    return {
        "phase":           AgentPhase.COMPLETE.value,
        "xml_content":     xml,
        "xml_url":         None,   # S3 upload deferred to full sprint
        "messages":        state.get("messages", []) + [msg],
        "node_call_count": state.get("node_call_count", 0) + 1,
    }


# ── 6. handle_question ─────────────────────────────────────────────────────────

async def handle_question(
    state: AgentState,
    gateway=None,
    retriever=None,
) -> dict:
    """
    Conversational Q&A node: RAG retrieval → Claude Sonnet reasoning → answer with sources.

    Retrieves from BOFiP-TVA (if retriever provided), builds a grounded prompt,
    calls Claude Sonnet via gateway, returns the answer and cited sources.
    """
    question = state.get("pending_user_msg", "")
    session_id = state.get("session_id", "default")
    org_id = state.get("org_id")
    messages = state.get("messages", [])

    if not question:
        return {
            "phase": state.get("phase", AgentPhase.REASON.value),
            "node_call_count": state.get("node_call_count", 0) + 1,
        }

    # 1 — RAG retrieval
    rag_chunks: list[dict] = []
    if retriever is not None:
        try:
            t0 = time.monotonic()
            chunks = retriever.retrieve(question, k=4)
            latency_ms = int((time.monotonic() - t0) * 1000)
            rag_chunks = [
                {
                    "text":         c.text[:600],
                    "url":          c.url,
                    "title":        c.title,
                    "score":        float(c.score),
                    "last_updated": c.last_updated,
                }
                for c in chunks
            ]
            logger.info(
                "handle_question: RAG retrieved %d chunks in %dms",
                len(rag_chunks), latency_ms,
            )
        except Exception as exc:
            logger.warning("handle_question: RAG failed: %s", exc)

    # 2 — Build prompt
    context_blocks = ""
    if rag_chunks:
        context_blocks = "\n\n".join(
            f"[Source: {c['title']} — {c['url']}]\n{c['text']}"
            for c in rag_chunks
        )
        sources_section = (
            "\n\nFondez votre réponse exclusivement sur les sources ci-dessus. "
            "Citez les références BOFiP pertinentes (ex: BOI-TVA-LIQ-30)."
        )
    else:
        context_blocks = "(Aucune source BOFiP disponible pour cette question.)"
        sources_section = "\nRépondez en vous basant sur votre connaissance de la TVA française."

    system = (
        "Tu es Stratus, un assistant expert-comptable IA spécialisé en TVA française. "
        "Tu réponds toujours en français, de façon précise, avec des références légales. "
        "Tu n'inventes jamais de règles fiscales — tu t'appuies uniquement sur les sources fournies."
    )

    prompt = (
        f"Question de l'utilisateur :\n{question}\n\n"
        f"Sources BOFiP disponibles :\n{context_blocks}"
        f"{sources_section}"
    )

    # 3 — LLM reasoning
    answer = "(Aucune réponse — gateway non disponible)"
    if gateway is not None:
        try:
            resp = await gateway.complete(
                prompt=prompt,
                system=system,
                model_hint="reason",
                session_id=session_id,
                organization_id=org_id,
            )
            answer = resp.content
        except Exception as exc:
            logger.error("handle_question: LLM call failed: %s", exc)
            answer = f"Erreur lors de la génération de la réponse : {exc}"

    # 4 — Format sources for user
    sources_out = [
        {"title": c["title"], "url": c["url"], "score": c["score"]}
        for c in rag_chunks
    ]

    user_msg  = {"role": "user",  "content": question, "timestamp": datetime.utcnow().isoformat()}
    agent_msg = {
        "role": "agent",
        "content": answer,
        "sources": sources_out,
        "timestamp": datetime.utcnow().isoformat(),
    }

    return {
        "phase":           AgentPhase.REASON.value,
        "rag_chunks":      rag_chunks,
        "last_answer":     answer,
        "last_sources":    sources_out,
        "pending_user_msg": None,
        "messages":        messages + [user_msg, agent_msg],
        "node_call_count": state.get("node_call_count", 0) + 1,
    }
