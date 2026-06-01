"""
Tests for the Stratus agent orchestrator (LangGraph graph).

Three test scenarios — all run fully offline (no API keys, no DB, no Redis):

1. Happy path     : FEC upload → classify → compute CA3 → generate XML
2. Clarification  : low-confidence entries → clarification questions emitted
3. Conversational : "Quel est le taux de TVA sur la restauration ?" → RAG → BOFiP source cited

All LLM calls are mocked. RAG uses the real BM25 index over the 5 BOFiP fixtures.

PRD reference: §4.3 "Deal Room".
"""
from __future__ import annotations

import json
import math
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Optional

import pytest

from src.agent.graph import build_graph, N_INGEST, N_CLASSIFY, N_COMPUTE, N_GENERATE, N_REASON
from src.agent.state import AgentPhase, new_session_state
from src.llm.gateway import LLMGateway
from src.llm.models import LLMResponse, DEFAULT_ANTHROPIC_MODEL
from src.llm.pii_scrubber import PIIScrubber

# ── Paths ──────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent.parent.parent  # stratus/
DOCS_DIR  = REPO_ROOT / "docs" / "bofip_tva"

# ── Mock gateway factory ──────────────────────────────────────────────────────

def _mock_gateway(content: str = '{"next_node": "compute_ca3", "reasoning": "ok"}') -> LLMGateway:
    """Gateway whose _call_anthropic always returns the given content."""
    gw = LLMGateway(
        anthropic_api_key="test-key",
        mistral_api_key="test-key",
        scrubber=PIIScrubber(),
        tracer=None,
    )
    async def _fake(prompt, system, model, tools):
        return LLMResponse(
            content=content,
            model_used=DEFAULT_ANTHROPIC_MODEL,
            input_tokens=10, output_tokens=10,
            latency_ms=0, fallback_used=False,
        )
    gw._call_anthropic = _fake  # type: ignore[method-assign]
    return gw


# ── Fake BOFiP retriever ──────────────────────────────────────────────────────

VOCAB = [
    "restaurant", "restauration", "taux", "reduit", "hotellerie",
    "autoliquidation", "btp", "soustraitance", "soustraitant",
    "oss", "guichet", "unique", "distance",
    "credit", "remboursement", "deductible",
    "deb", "des", "intracommunautaire", "echanges",
]
VOCAB_IDX = {w: i for i, w in enumerate(VOCAB)}
DIM = len(VOCAB)


def _fake_embed(text: str) -> list[float]:
    import re, unicodedata
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    tokens = set(re.split(r"[^a-z0-9]+", t))
    vec = [1.0 if w in tokens else 0.0 for w in VOCAB]
    norm = math.sqrt(sum(x*x for x in vec)) or 1.0
    return [x / norm for x in vec]


class _FakeEmbedder:
    dim = DIM
    def embed(self, texts): return [_fake_embed(t) for t in texts]
    def embed_query(self, text): return _fake_embed(text)


def _build_retriever():
    """Build an in-memory BOFiPRetriever over the 5 HTML fixtures."""
    import sys, uuid
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    from ingest_bofip import parse_html, chunk_text

    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct
    from src.rag.bofip_retriever import BOFiPRetriever, COLLECTION_NAME

    corpus = []
    html_files = sorted(DOCS_DIR.glob("*.html"))
    for p in html_files:
        page = parse_html(p)
        for c in chunk_text(page, chunk_tokens=500, overlap_tokens=50):
            corpus.append({
                "text": c.text, "url": c.url, "title": c.title,
                "section_path": c.section_path, "last_updated": c.last_updated,
                "bofip_id": c.bofip_id, "chunk_index": c.chunk_index,
            })

    embedder = _FakeEmbedder()
    client = QdrantClient(location=":memory:")
    client.create_collection(COLLECTION_NAME, vectors_config=VectorParams(size=DIM, distance=Distance.COSINE))
    points = [
        PointStruct(id=str(uuid.uuid4()), vector=embedder.embed([c["text"]])[0], payload=c)
        for c in corpus
    ]
    client.upsert(collection_name=COLLECTION_NAME, points=points)

    return BOFiPRetriever(
        qdrant_client=client, embedder=embedder,
        corpus_chunks=corpus, db_pool=None, collection_name=COLLECTION_NAME,
    )


# ── Shared fixtures ───────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def retriever():
    return _build_retriever()


def _base_state(**overrides) -> dict:
    state = new_session_state(
        session_id="test-session",
        org_id="org-001",
        fiscal_client_id="client-001",
    )
    state.update({
        "fec_import_id":     "import-001",
        "fec_entries_count": 20,
        "fec_period_start":  "2025-01-01",
        "fec_period_end":    "2025-01-31",
        "period_type":       "mensuelle",
    })
    state.update(overrides)
    return state


# ── 1. Happy path: FEC → classify → CA3 → XML ─────────────────────────────────

class TestHappyPath:
    """
    Full pipeline in one session:
      ingest_fec → classify_entries (high confidence) → compute_ca3 → generate_xml
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        self.graph = build_graph()   # no gateway needed for happy path
        self.entries = [
            {"vat_type": "collectee_20",  "base_ht": "10000.00", "tva_amount": "2000.00",
             "confidence": 1.0, "method": "rule"},
            {"vat_type": "deductible_20", "base_ht": "5000.00",  "tva_amount": "1000.00",
             "confidence": 1.0, "method": "rule"},
        ]

    async def test_final_phase_is_complete(self):
        state = _base_state(classified_entries=self.entries)
        result = await self.graph.ainvoke(state)
        assert result["phase"] == AgentPhase.COMPLETE.value, (
            f"Expected COMPLETE, got {result['phase']}. error={result.get('last_error')}"
        )

    async def test_ca3_lines_computed(self):
        state = _base_state(classified_entries=self.entries)
        result = await self.graph.ainvoke(state)
        assert result.get("ca3_lines") is not None, "ca3_lines should be populated"
        lines = result["ca3_lines"]
        assert lines["L24"] == "1000.00", f"L24 should be 1000.00, got {lines['L24']}"
        assert lines["L25"] == "0.00"

    async def test_xml_generated(self):
        state = _base_state(classified_entries=self.entries)
        result = await self.graph.ainvoke(state)
        xml = result.get("xml_content", "")
        assert "<DeclarationTVA" in xml, "XML output should contain DeclarationTVA element"
        assert "1000.00" in xml, "L24 value should appear in XML"

    async def test_messages_trace_pipeline(self):
        state = _base_state(classified_entries=self.entries)
        result = await self.graph.ainvoke(state)
        messages = result.get("messages", [])
        contents = " ".join(m["content"] for m in messages)
        assert "FEC importé" in contents, "Should mention FEC import"
        assert "Classification terminée" in contents, "Should mention classification"
        assert "CA3" in contents, "Should mention CA3"

    async def test_node_call_count_bounded(self):
        state = _base_state(classified_entries=self.entries)
        result = await self.graph.ainvoke(state)
        assert result.get("node_call_count", 0) <= 20, "node_call_count must not exceed 20"

    async def test_no_errors(self):
        state = _base_state(classified_entries=self.entries)
        result = await self.graph.ainvoke(state)
        assert result.get("last_error") is None, f"Unexpected error: {result.get('last_error')}"

    async def test_ca3_validation_no_hard_errors(self):
        state = _base_state(classified_entries=self.entries)
        result = await self.graph.ainvoke(state)
        hard_errors = [v for v in result.get("ca3_validation", []) if v["severity"] == "error"]
        assert not hard_errors, f"Unexpected CA3 hard errors: {hard_errors}"


# ── 2. Clarification path: low confidence triggers questions ───────────────────

class TestClarificationPath:
    """
    When > 5% of entries have confidence < 0.7, the graph should:
      - transition to CLARIFY phase
      - emit clarification_questions
      - halt (await user response)
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        # Mock gateway that returns clarification questions (classify hint)
        self.gateway = _mock_gateway(
            content="Confirmez-vous que cette écriture est exonérée de TVA ?"
        )
        self.graph = build_graph(gateway=self.gateway)

    async def test_clarify_phase_triggered(self):
        # 3 of 5 entries (60%) have low confidence
        entries = [
            {"vat_type": "collectee_20", "base_ht": "5000", "tva_amount": "1000",
             "confidence": 1.0, "method": "rule"},
            {"vat_type": "ambiguous", "base_ht": "1000", "tva_amount": "0",
             "confidence": 0.4, "method": "llm"},
            {"vat_type": "hors_champ", "base_ht": "2000", "tva_amount": "0",
             "confidence": 0.5, "method": "llm"},
            {"vat_type": "ambiguous", "base_ht": "500",  "tva_amount": "0",
             "confidence": 0.3, "method": "llm"},
            {"vat_type": "collectee_10", "base_ht": "800", "tva_amount": "80",
             "confidence": 0.6, "method": "llm"},
        ]
        state = _base_state(classified_entries=entries)
        result = await self.graph.ainvoke(state)

        # Should be CLARIFY (graph halts after emitting questions)
        assert result["phase"] == AgentPhase.CLARIFY.value, (
            f"Expected CLARIFY, got {result['phase']}"
        )

    async def test_clarification_questions_emitted(self):
        entries = [
            {"vat_type": "collectee_20",  "base_ht": "5000", "tva_amount": "1000",
             "confidence": 1.0, "method": "rule"},
            {"vat_type": "ambiguous", "base_ht": "1000", "tva_amount": "0",
             "confidence": 0.3, "ecriture_lib": "Achat divers", "compte_num": "60000",
             "method": "llm"},
            {"vat_type": "ambiguous", "base_ht": "800", "tva_amount": "0",
             "confidence": 0.4, "ecriture_lib": "Frais véhicule", "compte_num": "61000",
             "method": "llm"},
            {"vat_type": "ambiguous", "base_ht": "600", "tva_amount": "0",
             "confidence": 0.5, "ecriture_lib": "Note honoraires", "compte_num": "62100",
             "method": "llm"},
        ]
        state = _base_state(classified_entries=entries)
        result = await self.graph.ainvoke(state)

        questions = result.get("clarification_questions", [])
        assert len(questions) > 0, "Should have produced clarification questions"

    async def test_clarify_message_in_history(self):
        entries = [
            {"vat_type": "collectee_20", "base_ht": "5000", "tva_amount": "1000",
             "confidence": 1.0, "method": "rule"},
        ] + [
            {"vat_type": "ambiguous", "base_ht": "200", "tva_amount": "0",
             "confidence": 0.2, "method": "llm", "ecriture_lib": f"Op {i}",
             "compte_num": f"6000{i}"}
            for i in range(4)
        ]
        state = _base_state(classified_entries=entries)
        result = await self.graph.ainvoke(state)

        if result["phase"] == AgentPhase.CLARIFY.value:
            agent_msgs = [m for m in result["messages"] if m["role"] == "agent"]
            clarify_msg = next((m for m in agent_msgs if "précisions" in m.get("content", "")), None)
            assert clarify_msg is not None, "Should have a clarification message in history"

    async def test_high_confidence_skips_clarification(self):
        """All entries at confidence 1.0 → should skip CLARIFY → go straight to COMPUTE."""
        entries = [
            {"vat_type": "collectee_20", "base_ht": "10000", "tva_amount": "2000",
             "confidence": 1.0, "method": "rule"},
            {"vat_type": "deductible_20", "base_ht": "3000", "tva_amount": "600",
             "confidence": 1.0, "method": "rule"},
        ]
        state = _base_state(classified_entries=entries)
        graph = build_graph()   # no gateway
        result = await graph.ainvoke(state)
        assert result["phase"] == AgentPhase.COMPLETE.value, (
            f"High confidence should reach COMPLETE, got {result['phase']}"
        )


# ── 3. Conversational: RAG → BOFiP source cited ────────────────────────────────

class TestConversational:
    """
    Conversational Q&A via handle_question node.
    Verifies that the correct BOFiP article is cited in the answer sources.
    """

    @pytest.fixture(autouse=True)
    def setup(self, retriever):
        self.retriever = retriever
        # Gateway returns a grounded answer mentioning the BOFiP reference
        self.gateway = _mock_gateway(
            content=(
                "Le taux de TVA réduit de 10 % s'applique aux prestations de restauration "
                "en vertu de l'article 279 du CGI (BOI-TVA-LIQ-30). "
                "Les boissons alcooliques restent au taux normal de 20 %."
            )
        )

    async def test_restaurant_question_reaches_reason(self):
        state = _base_state(
            phase=AgentPhase.REASON.value,
            pending_user_msg="Quel est le taux de TVA sur la restauration ?",
        )
        graph = build_graph(gateway=self.gateway, retriever=self.retriever)
        result = await graph.ainvoke(state)
        assert result["phase"] == AgentPhase.REASON.value, (
            f"Expected REASON after Q&A, got {result['phase']}"
        )

    async def test_rag_chunks_retrieved(self):
        state = _base_state(
            phase=AgentPhase.REASON.value,
            pending_user_msg="Quel est le taux de TVA sur la restauration ?",
        )
        graph = build_graph(gateway=self.gateway, retriever=self.retriever)
        result = await graph.ainvoke(state)
        chunks = result.get("rag_chunks", [])
        assert len(chunks) > 0, "RAG should retrieve chunks for a TVA restaurant query"

    async def test_bofip_liq30_in_top3_sources(self):
        """BOI-TVA-LIQ-30 must be in the top-3 retrieved sources."""
        state = _base_state(
            phase=AgentPhase.REASON.value,
            pending_user_msg="Quel est le taux de TVA sur la restauration ?",
        )
        graph = build_graph(gateway=self.gateway, retriever=self.retriever)
        result = await graph.ainvoke(state)
        sources = result.get("last_sources", [])
        bofip_ids = [s.get("title", "") + s.get("url", "") for s in sources]
        found = any("BOI-TVA-LIQ-30" in s for s in bofip_ids)
        assert found, (
            f"BOI-TVA-LIQ-30 should be in sources. Got: {[s.get('url') for s in sources]}"
        )

    async def test_answer_contains_tva_content(self):
        state = _base_state(
            phase=AgentPhase.REASON.value,
            pending_user_msg="Quel est le taux de TVA sur la restauration ?",
        )
        graph = build_graph(gateway=self.gateway, retriever=self.retriever)
        result = await graph.ainvoke(state)
        answer = result.get("last_answer", "")
        assert "TVA" in answer or "taux" in answer.lower(), (
            f"Answer should discuss TVA. Got: {answer[:200]}"
        )

    async def test_conversational_adds_both_messages(self):
        """User question AND agent answer should appear in messages."""
        question = "Quel est le taux de TVA sur la restauration ?"
        state = _base_state(
            phase=AgentPhase.REASON.value,
            pending_user_msg=question,
        )
        graph = build_graph(gateway=self.gateway, retriever=self.retriever)
        result = await graph.ainvoke(state)
        roles = [m["role"] for m in result.get("messages", [])]
        assert "user" in roles, "User message should be in history"
        assert "agent" in roles, "Agent reply should be in history"

    async def test_autoliquidation_btp_cites_decla_10_10_20(self):
        """Q about autoliquidation BTP → BOI-TVA-DECLA-10-10-20 in sources."""
        gateway = _mock_gateway(
            content="L'autoliquidation s'applique en vertu de l'article 283-2nonies (BOI-TVA-DECLA-10-10-20)."
        )
        state = _base_state(
            phase=AgentPhase.REASON.value,
            pending_user_msg="TVA autoliquidation BTP sous-traitance — comment ça marche ?",
        )
        graph = build_graph(gateway=gateway, retriever=self.retriever)
        result = await graph.ainvoke(state)
        sources = result.get("last_sources", [])
        bofip_ids = [s.get("title", "") + s.get("url", "") for s in sources]
        found = any("BOI-TVA-DECLA-10-10-20" in s for s in bofip_ids)
        assert found, (
            f"BOI-TVA-DECLA-10-10-20 should be in sources. Got: {[s.get('url') for s in sources]}"
        )

    async def test_credit_tva_question_cites_decla_30_10_20(self):
        """Q about crédit TVA remboursement → BOI-TVA-DECLA-30-10-20 in sources."""
        gateway = _mock_gateway(
            content="Le remboursement de crédit TVA est régi par BOI-TVA-DECLA-30-10-20."
        )
        state = _base_state(
            phase=AgentPhase.REASON.value,
            pending_user_msg="Comment obtenir le remboursement d'un crédit TVA ?",
        )
        graph = build_graph(gateway=gateway, retriever=self.retriever)
        result = await graph.ainvoke(state)
        sources = result.get("last_sources", [])
        bofip_ids = [s.get("title", "") + s.get("url", "") for s in sources]
        found = any("BOI-TVA-DECLA-30-10-20" in s for s in bofip_ids)
        assert found, f"BOI-TVA-DECLA-30-10-20 not found. Sources: {sources}"


# ── 4. Session store tests (in-memory fallback) ────────────────────────────────

class TestSessionStore:
    async def test_save_and_load_session(self):
        from src.agent.session_store import save_session, load_session
        sid = "test-store-001"
        state = {"session_id": sid, "phase": "compute", "node_call_count": 3}
        await save_session(sid, state)
        loaded = await load_session(sid)
        assert loaded is not None
        assert loaded["phase"] == "compute"
        assert loaded["node_call_count"] == 3

    async def test_load_missing_session_returns_none(self):
        from src.agent.session_store import load_session
        result = await load_session("nonexistent-session-xyz")
        assert result is None

    async def test_delete_session(self):
        from src.agent.session_store import save_session, load_session, delete_session
        sid = "test-store-del"
        await save_session(sid, {"session_id": sid})
        await delete_session(sid)
        result = await load_session(sid)
        assert result is None


# ── 5. Graph guards ────────────────────────────────────────────────────────────

class TestGraphGuards:
    async def test_empty_entries_raises_error_phase(self):
        """compute_ca3 with no entries should set phase=error."""
        state = _base_state(
            classified_entries=[],           # no entries
            phase=AgentPhase.COMPUTE.value,
        )
        # Invoke just the compute node directly
        from src.agent.nodes import compute_ca3 as _compute_node
        result = await _compute_node(state)
        assert result["phase"] == AgentPhase.ERROR.value
        assert result.get("last_error") is not None

    async def test_new_session_state_defaults(self):
        from src.agent.state import new_session_state
        s = new_session_state("s1", "org1", "client1")
        assert s["phase"]            == AgentPhase.INGEST.value
        assert s["node_call_count"]  == 0
        assert s["messages"]         == []
        assert s["classified_entries"] == []
