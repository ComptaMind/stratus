"""
Agent API endpoints.

POST /v1/agent/sessions          — create a new agent session
POST /v1/agent/sessions/:id/messages — send a user message, get SSE stream
GET  /v1/agent/sessions/:id/state    — debug: current state snapshot

SSE streaming format (each event):
  data: {"type": "delta", "content": "..."}\n\n
  data: {"type": "sources", "sources": [...]}\n\n
  data: {"type": "state", "phase": "...", "node_call_count": N}\n\n
  data: {"type": "done"}\n\n

PRD reference: §4.3 "Deal Room".
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from typing import AsyncIterator, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ...agent.graph import build_graph
from ...agent.session_store import save_session, load_session, delete_session
from ...agent.state import AgentPhase, AgentState, new_session_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/agent", tags=["agent"])

# ── Singleton graph (built once at startup) ───────────────────────────────────

_compiled_graph = None


def _get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        # In production: inject real gateway, classifier, retriever
        # For MVP: build without dependencies (nodes degrade gracefully)
        _compiled_graph = build_graph()
    return _compiled_graph


# ── Request / Response models ─────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    org_id:            str
    fiscal_client_id:  str
    user_id:           str  = "anonymous"
    period_type:       str  = Field("mensuelle", pattern="^(mensuelle|trimestrielle)$")
    fec_import_id:     Optional[str] = None
    fec_entries_count: int  = 0
    fec_period_start:  Optional[str] = None
    fec_period_end:    Optional[str] = None
    classified_entries: list[dict] = Field(default_factory=list)
    credit_tva_anterieur: str = "0"


class CreateSessionResponse(BaseModel):
    session_id: str
    phase:      str
    created_at: str


class SendMessageRequest(BaseModel):
    message: str
    role:    str = "user"


class SessionStateResponse(BaseModel):
    session_id:       str
    phase:            str
    node_call_count:  int
    messages_count:   int
    ca3_ready:        bool
    xml_ready:        bool
    last_error:       Optional[str]


# ── POST /v1/agent/sessions ───────────────────────────────────────────────────

@router.post("/sessions", response_model=CreateSessionResponse, status_code=201)
async def create_session(body: CreateSessionRequest) -> CreateSessionResponse:
    """Start a new agent session. Returns session_id to use in subsequent calls."""
    session_id = str(uuid.uuid4())
    state = new_session_state(
        session_id=session_id,
        org_id=body.org_id,
        fiscal_client_id=body.fiscal_client_id,
        user_id=body.user_id,
        period_type=body.period_type,
    )
    # Inject FEC context if provided
    if body.fec_import_id:
        state["fec_import_id"]      = body.fec_import_id
        state["fec_entries_count"]  = body.fec_entries_count
        state["fec_period_start"]   = body.fec_period_start
        state["fec_period_end"]     = body.fec_period_end
    if body.classified_entries:
        state["classified_entries"] = body.classified_entries
    state["credit_tva_anterieur"] = body.credit_tva_anterieur

    await save_session(session_id, state)
    logger.info("Session created: %s (client=%s)", session_id, body.fiscal_client_id)

    return CreateSessionResponse(
        session_id=session_id,
        phase=state["phase"],
        created_at=datetime.utcnow().isoformat(),
    )


# ── POST /v1/agent/sessions/:id/messages ─────────────────────────────────────

@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, body: SendMessageRequest) -> StreamingResponse:
    """
    Send a user message to the agent session.
    Returns a Server-Sent Events stream of agent responses.
    """
    state = await load_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found or expired.")

    # Inject user message
    state["pending_user_msg"] = body.message

    # If in REASON phase or message looks like a question, stay conversational
    phase = state.get("phase", AgentPhase.INGEST.value)
    from ...agent.graph import _looks_like_question

    if phase == AgentPhase.REASON.value or _looks_like_question(body.message):
        state["phase"] = AgentPhase.REASON.value

    return StreamingResponse(
        _stream_graph_run(session_id, state),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream_graph_run(session_id: str, state: dict) -> AsyncIterator[str]:
    """Run the LangGraph graph and stream SSE events to the client."""
    graph = _get_graph()

    try:
        # Run graph (async invoke)
        final_state = await graph.ainvoke(state)

        # Stream the last agent message character by character (simulated delta)
        messages = final_state.get("messages", [])
        agent_msgs = [m for m in messages if m.get("role") == "agent"]
        if agent_msgs:
            last_msg = agent_msgs[-1]
            content = last_msg.get("content", "")
            # Stream in 20-char chunks for realistic SSE feel
            for i in range(0, len(content), 20):
                chunk = content[i:i+20]
                yield f"data: {json.dumps({'type': 'delta', 'content': chunk})}\n\n"
                await asyncio.sleep(0)   # yield control

            # Sources (if any)
            sources = last_msg.get("sources", [])
            if sources:
                yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

        # State summary event
        yield f"data: {json.dumps({'type': 'state', 'phase': final_state.get('phase'), 'node_call_count': final_state.get('node_call_count', 0)})}\n\n"

        # CA3 lines if just computed
        if final_state.get("ca3_lines"):
            yield f"data: {json.dumps({'type': 'ca3', 'lines': final_state['ca3_lines']})}\n\n"

        # Persist updated state
        await save_session(session_id, final_state)

    except Exception as exc:
        logger.error("Graph run error for session %s: %s", session_id, exc)
        yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    finally:
        yield "data: {\"type\": \"done\"}\n\n"


# ── GET /v1/agent/sessions/:id/state ─────────────────────────────────────────

@router.get("/sessions/{session_id}/state", response_model=SessionStateResponse)
async def get_session_state(session_id: str) -> SessionStateResponse:
    """Return the current state snapshot for debugging."""
    state = await load_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found or expired.")

    return SessionStateResponse(
        session_id=session_id,
        phase=state.get("phase", "unknown"),
        node_call_count=state.get("node_call_count", 0),
        messages_count=len(state.get("messages", [])),
        ca3_ready=state.get("ca3_lines") is not None,
        xml_ready=state.get("xml_content") is not None,
        last_error=state.get("last_error"),
    )
