"""
Stratus agent orchestrator — LangGraph StateGraph.

Graph topology
--------------

  [__start__]
       │
   ingest_fec                     ← always first
       │
   classify_entries
       │
   ┌───┴──────────────────────────┐
   │ low_confidence > 5%?         │
   │ YES                  NO      │
   ▼                     ▼       │
 ask_user_clarification  │       │
       │                 │       │
       └────────►  compute_ca3  ◄┘
                      │
                 generate_xml
                      │
                  [__end__]

Conversational mode (ReasonState):
  Any message arriving while phase=REASON → handle_question → REASON

Planner (Claude Sonnet 4.6):
  For ambiguous routing decisions (user replies to clarification,
  unsolicited questions during computation, etc.), the planner LLM
  inspects the current state + user message and decides the next node.

Session guard: node_call_count is incremented on every node call.
  If it exceeds MAX_NODE_CALLS (20) the graph routes to END.

PRD reference: §4.3 "Deal Room", §3.1 "Architecture overview".
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

from langgraph.graph import StateGraph, END

from .state import AgentPhase, AgentState
from . import nodes as _nodes

logger = logging.getLogger(__name__)

MAX_NODE_CALLS = 20

# ── Node names (constants to avoid magic strings) ─────────────────────────────

N_ROUTER   = "router"
N_INGEST   = "ingest_fec"
N_CLASSIFY = "classify_entries"
N_CLARIFY  = "ask_user_clarification"
N_COMPUTE  = "compute_ca3"
N_GENERATE = "generate_xml"
N_REASON   = "handle_question"
N_PLANNER  = "planner"

# ── Planner prompt ────────────────────────────────────────────────────────────

_PLANNER_SYSTEM = """\
Tu es l'orchestrateur d'un agent fiscal IA (Stratus).
Tu reçois l'état courant de la session et le dernier message utilisateur.
Tu dois choisir le prochain nœud à exécuter parmi :
  - ingest_fec        : analyser le FEC uploadé
  - classify_entries  : classifier les écritures TVA
  - ask_user_clarification : poser des questions à l'utilisateur
  - compute_ca3       : calculer la déclaration CA3
  - generate_xml      : générer l'EDI-TVA XML
  - handle_question   : répondre à une question conversationnelle
  - END               : terminer la session

Règles :
1. Si node_call_count >= 20, réponds END.
2. Si phase=error, réponds END.
3. Si l'utilisateur pose une question (commence par ?, comment, qu'est-ce, etc.) → handle_question.
4. Si phase=clarify ET message utilisateur = réponse à la clarification → compute_ca3.
5. Sinon, suis la progression naturelle de la session.

Réponds UNIQUEMENT avec un JSON valide :
{"next_node": "<nom_du_nœud>", "reasoning": "<explication courte>"}
"""


async def _planner_route(state: AgentState, gateway) -> str:
    """
    Call Claude Sonnet to decide the next node.
    Falls back to phase-based routing if LLM call fails.
    """
    if state.get("node_call_count", 0) >= MAX_NODE_CALLS:
        logger.warning("MAX_NODE_CALLS reached — ending session")
        return END

    phase = state.get("phase", AgentPhase.INGEST.value)

    if phase == AgentPhase.ERROR.value:
        return END
    if phase == AgentPhase.COMPLETE.value:
        return END

    # Short-circuit: deterministic routing when unambiguous
    pending = state.get("pending_user_msg", "")
    if pending and _looks_like_question(pending):
        return N_REASON

    # Phase-based default routing (no LLM needed for happy path)
    _phase_map = {
        AgentPhase.INGEST.value:    N_INGEST,
        AgentPhase.CLASSIFY.value:  N_CLASSIFY,
        AgentPhase.CLARIFY.value:   N_CLARIFY,
        AgentPhase.COMPUTE.value:   N_COMPUTE,
        AgentPhase.GENERATE.value:  N_GENERATE,
        AgentPhase.REASON.value:    N_REASON,
    }
    default = _phase_map.get(phase, END)

    if gateway is None:
        return default

    # Only call LLM for genuinely ambiguous situations
    if phase in (AgentPhase.CLARIFY.value,) and pending:
        prompt = (
            f"État courant : phase={phase}, node_calls={state.get('node_call_count', 0)}\n"
            f"Dernier message utilisateur : {pending[:300]}\n"
            f"Statistiques : {json.dumps(state.get('classification_stats', {}))}\n"
        )
        try:
            resp = await gateway.complete(
                prompt=prompt,
                system=_PLANNER_SYSTEM,
                model_hint="reason",
                session_id=state.get("session_id", "default"),
            )
            parsed = json.loads(resp.content)
            next_node = parsed.get("next_node", default)
            reasoning = parsed.get("reasoning", "")
            logger.info("Planner → %s (%s)", next_node, reasoning)
            # Validate node name
            valid = {N_INGEST, N_CLASSIFY, N_CLARIFY, N_COMPUTE, N_GENERATE, N_REASON, END}
            return next_node if next_node in valid else default
        except Exception as exc:
            logger.warning("Planner LLM failed, using default: %s", exc)
            return default

    return default


def _looks_like_question(text: str) -> bool:
    """Heuristic: does this text look like a user question?"""
    t = text.strip().lower()
    starters = ("?", "comment", "qu'est", "quel", "quell", "est-ce", "pourquoi",
                 "peut-on", "faut-il", "quelle", "combien", "où", "when", "what",
                 "how ", "taux ", "règle")
    return t.endswith("?") or any(t.startswith(s) for s in starters)


# ── Guard: loop breaker ───────────────────────────────────────────────────────

def _check_loop_guard(state: AgentState) -> str:
    """Route to END if max node calls exceeded or phase is terminal."""
    calls = state.get("node_call_count", 0)
    phase = state.get("phase", "")
    if calls >= MAX_NODE_CALLS or phase in (AgentPhase.ERROR.value, AgentPhase.COMPLETE.value):
        return END
    return "continue"


# ── Routing functions (used as conditional edge lambdas) ──────────────────────

def _route_after_classify(state: AgentState) -> str:
    phase = state.get("phase", "")
    if phase == AgentPhase.CLARIFY.value:
        return N_CLARIFY
    if phase == AgentPhase.COMPUTE.value:
        return N_COMPUTE
    return END


def _route_after_clarify(state: AgentState) -> str:
    """After clarification questions are sent, we wait for user reply → END for now."""
    return END


def _route_after_compute(state: AgentState) -> str:
    phase = state.get("phase", "")
    if phase == AgentPhase.ERROR.value:
        return END
    return N_GENERATE


def _route_after_generate(state: AgentState) -> str:
    return END


def _route_after_reason(state: AgentState) -> str:
    """After handling a question, remain in REASON for follow-ups or END."""
    return END


# ── Graph builder ─────────────────────────────────────────────────────────────

def build_graph(
    gateway=None,
    classifier=None,
    retriever=None,
) -> Any:
    """
    Build and compile the Stratus agent StateGraph.

    Parameters
    ----------
    gateway : LLMGateway, optional
        Used by planner, ask_user_clarification, handle_question.
    classifier : VATClassifier, optional
        Injected into classify_entries (for production DB-backed classification).
    retriever : BOFiPRetriever, optional
        Injected into handle_question for RAG.

    Returns
    -------
    CompiledStateGraph
        Callable as: compiled.invoke(initial_state) or compiled.ainvoke(...)
    """
    # ── Wrap nodes with dependency injection ──────────────────────────────────

    async def _ingest(state: AgentState) -> dict:
        _emit_transition_audit(state, "START", N_INGEST, "(entry)")
        return await _nodes.ingest_fec(state)

    async def _classify(state: AgentState) -> dict:
        _emit_transition_audit(state, N_INGEST, N_CLASSIFY, "after ingest")
        return await _nodes.classify_entries(state, classifier=classifier)

    async def _clarify(state: AgentState) -> dict:
        _emit_transition_audit(state, N_CLASSIFY, N_CLARIFY, "low confidence")
        return await _nodes.ask_user_clarification(state, gateway=gateway)

    async def _compute(state: AgentState) -> dict:
        prev = N_CLARIFY if state.get("phase") == AgentPhase.CLARIFY.value else N_CLASSIFY
        _emit_transition_audit(state, prev, N_COMPUTE, "classification complete")
        return await _nodes.compute_ca3(state)

    async def _generate(state: AgentState) -> dict:
        _emit_transition_audit(state, N_COMPUTE, N_GENERATE, "CA3 computed")
        return await _nodes.generate_xml(state)

    async def _reason(state: AgentState) -> dict:
        _emit_transition_audit(state, state.get("phase", "?"), N_REASON, "question received")
        return await _nodes.handle_question(state, gateway=gateway, retriever=retriever)

    # ── Build StateGraph ──────────────────────────────────────────────────────

    graph = StateGraph(AgentState)

    # Router: inspects current phase and dispatches to the right node
    async def _router(state: AgentState) -> dict:
        """Pass-through entry-point node; routing is done via conditional edges."""
        return {}   # no state mutations — routing handled by _route_from_router

    graph.add_node(N_ROUTER,   _router)
    graph.add_node(N_INGEST,   _ingest)
    graph.add_node(N_CLASSIFY, _classify)
    graph.add_node(N_CLARIFY,  _clarify)
    graph.add_node(N_COMPUTE,  _compute)
    graph.add_node(N_GENERATE, _generate)
    graph.add_node(N_REASON,   _reason)

    # ── Entry point ───────────────────────────────────────────────────────────
    graph.set_entry_point(N_ROUTER)

    # ── Routing from entry router ─────────────────────────────────────────────
    def _route_from_router(state: AgentState) -> str:
        """Dispatch to the right first node based on current session phase."""
        phase = state.get("phase", AgentPhase.INGEST.value)
        pending = state.get("pending_user_msg", "")

        # Conversational: question in any phase goes to handle_question
        if phase == AgentPhase.REASON.value:
            return N_REASON
        if pending and _looks_like_question(pending):
            return N_REASON

        _map = {
            AgentPhase.INGEST.value:    N_INGEST,
            AgentPhase.CLASSIFY.value:  N_CLASSIFY,
            AgentPhase.CLARIFY.value:   N_CLARIFY,
            AgentPhase.COMPUTE.value:   N_COMPUTE,
            AgentPhase.GENERATE.value:  N_GENERATE,
        }
        return _map.get(phase, END)

    graph.add_conditional_edges(
        N_ROUTER,
        _route_from_router,
        {N_INGEST: N_INGEST, N_CLASSIFY: N_CLASSIFY, N_CLARIFY: N_CLARIFY,
         N_COMPUTE: N_COMPUTE, N_GENERATE: N_GENERATE, N_REASON: N_REASON, END: END},
    )

    # ── Edges ─────────────────────────────────────────────────────────────────
    graph.add_edge(N_INGEST, N_CLASSIFY)

    graph.add_conditional_edges(
        N_CLASSIFY,
        _route_after_classify,
        {N_CLARIFY: N_CLARIFY, N_COMPUTE: N_COMPUTE, END: END},
    )

    graph.add_conditional_edges(
        N_CLARIFY,
        _route_after_clarify,
        {END: END},
    )

    graph.add_conditional_edges(
        N_COMPUTE,
        _route_after_compute,
        {N_GENERATE: N_GENERATE, END: END},
    )

    graph.add_conditional_edges(
        N_GENERATE,
        _route_after_generate,
        {END: END},
    )

    graph.add_conditional_edges(
        N_REASON,
        _route_after_reason,
        {END: END},
    )

    return graph.compile()


# ── Transition audit helper ───────────────────────────────────────────────────

def _emit_transition_audit(
    state: AgentState,
    from_node: str,
    to_node: str,
    reasoning: str,
) -> None:
    """Log state transition. Non-fatal — pool may be absent."""
    pool = state.get("audit_pool")
    if pool is None:
        logger.debug("agent.transition: %s → %s (%s)", from_node, to_node, reasoning)
        return

    import asyncio, json
    payload = json.dumps({
        "from_state": state.get("phase"),
        "to_state":   to_node,
        "node":       to_node,
        "planner_decision": state.get("planner_next_node"),
        "planner_reasoning": reasoning,
    })
    org_id     = state.get("org_id", "system")
    session_id = state.get("session_id", "unknown")

    async def _write() -> None:
        try:
            await pool.execute(
                """
                INSERT INTO audit_events
                  (org_id, actor_type, actor_id, action, entity_type, entity_id, payload)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                """,
                org_id, "agent", "stratus-agent",
                "agent.transition", "AgentSession", session_id, payload,
            )
        except Exception as exc:
            logger.debug("Transition audit failed (non-fatal): %s", exc)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(_write())
    except RuntimeError:
        pass
