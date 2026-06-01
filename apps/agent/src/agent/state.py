"""
Agent state schema for the Stratus LangGraph orchestrator.

AgentState is the single TypedDict that flows through the StateGraph.
Every node receives the full state and returns a (possibly partial) update.

State lifecycle:
  IngestState → ClassifyState → [ClarifyState] → ComputeState → FileState
                                                ↕
                                          ReasonState (conversational)

PRD reference: §4.3 "Deal Room", §3.1 "Architecture overview".
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from typing_extensions import TypedDict


class AgentPhase(str, Enum):
    """Current phase of the agent session."""
    INGEST     = "ingest"       # FEC just received, not yet parsed
    CLASSIFY   = "classify"     # Entries being classified
    CLARIFY    = "clarify"      # Awaiting user clarification
    COMPUTE    = "compute"      # Running CA3 engine
    GENERATE   = "generate"     # Generating EDI-TVA XML
    REASON     = "reason"       # Conversational Q&A mode
    COMPLETE   = "complete"     # Declaration ready / session done
    ERROR      = "error"        # Unrecoverable error


class AgentState(TypedDict, total=False):
    """
    Full agent session state — carried through every LangGraph node.

    Fields are Optional (total=False) so nodes can return partial updates.
    """

    # ── Session identity ──────────────────────────────────────────────────────
    session_id:        str
    org_id:            str
    fiscal_client_id:  str
    user_id:           str
    phase:             str          # AgentPhase value

    # ── Conversation ──────────────────────────────────────────────────────────
    messages:          list[dict]   # [{role, content, timestamp}]
    pending_user_msg:  Optional[str]
    node_call_count:   int          # guards against infinite loops (max 20)

    # ── FEC / Classification ──────────────────────────────────────────────────
    fec_import_id:     Optional[str]
    fec_entries_count: int
    fec_period_start:  Optional[str]    # ISO date string
    fec_period_end:    Optional[str]
    period_type:       str              # 'mensuelle' | 'trimestrielle'

    classified_entries: list[dict]      # [{"vat_type", "base_ht", "tva_amount"}]
    classification_stats: dict          # {"total", "deterministic", "llm", "ambiguous"}
    low_confidence_entries: list[dict]  # entries with confidence < 0.7
    clarification_questions: list[str]

    # ── CA3 / Declaration ─────────────────────────────────────────────────────
    ca3_lines:          Optional[dict]  # CA3Lines.to_json_dict()
    ca3_validation:     list[dict]      # [{"severity", "code", "message"}]
    ca3_declaration_id: Optional[str]
    credit_tva_anterieur: str           # Decimal string, default "0"

    # ── XML / EDI ─────────────────────────────────────────────────────────────
    xml_url:            Optional[str]
    xml_content:        Optional[str]   # kept in-memory for tests

    # ── RAG / Conversational ──────────────────────────────────────────────────
    rag_chunks:         list[dict]      # [{text, url, title, score}]
    last_answer:        Optional[str]
    last_sources:       list[dict]

    # ── Planner ───────────────────────────────────────────────────────────────
    planner_next_node:  Optional[str]
    planner_reasoning:  Optional[str]

    # ── Audit / errors ────────────────────────────────────────────────────────
    last_error:         Optional[str]
    audit_pool:         Any             # asyncpg.Pool — passed through, not serialised


# ── Convenience constructors ─────────────────────────────────────────────────

def new_session_state(
    session_id: str,
    org_id: str,
    fiscal_client_id: str,
    user_id: str = "anonymous",
    period_type: str = "mensuelle",
) -> AgentState:
    """Create the initial state for a new agent session."""
    return AgentState(
        session_id=session_id,
        org_id=org_id,
        fiscal_client_id=fiscal_client_id,
        user_id=user_id,
        phase=AgentPhase.INGEST.value,
        messages=[],
        pending_user_msg=None,
        node_call_count=0,
        fec_import_id=None,
        fec_entries_count=0,
        fec_period_start=None,
        fec_period_end=None,
        period_type=period_type,
        classified_entries=[],
        classification_stats={},
        low_confidence_entries=[],
        clarification_questions=[],
        ca3_lines=None,
        ca3_validation=[],
        ca3_declaration_id=None,
        credit_tva_anterieur="0",
        xml_url=None,
        xml_content=None,
        rag_chunks=[],
        last_answer=None,
        last_sources=[],
        planner_next_node=None,
        planner_reasoning=None,
        last_error=None,
        audit_pool=None,
    )
