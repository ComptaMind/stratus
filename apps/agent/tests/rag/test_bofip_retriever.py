"""
Tests for BOFiPRetriever — hybrid dense + sparse retrieval.

All tests run fully offline:
  - In-memory Qdrant (QdrantClient(":memory:"))
  - Deterministic fake embedder (keyword-based sparse vectors)
  - BM25 over the 5 BOFiP fixture documents

Test oracle: for each of the 5 TVA questions, the expected BOFiP document
URL/ID must appear in the top-3 retrieved chunks.

Fixtures verified:
  Q1: "Taux TVA réduit restaurant"          → BOI-TVA-LIQ-30
  Q2: "TVA autoliquidation BTP sous-traitance" → BOI-TVA-DECLA-10-10-20
  Q3: "OSS guichet unique TVA"              → BOI-TVA-DECLA-20-20-50
  Q4: "Crédit TVA remboursement"            → BOI-TVA-DECLA-30-10-20
  Q5: "DEB DES intracommunautaire"          → BOI-TVA-DECLA-20-20-40
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Optional

import pytest

# ── Paths ──────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent  # stratus/
DOCS_DIR = REPO_ROOT / "docs" / "bofip_tva"

# ── Fake embedder ──────────────────────────────────────────────────────────

VOCAB = [
    # TVA-LIQ-30 keywords
    "restaurant", "restauration", "taux", "reduit", "hotellerie",
    "10", "5.5", "nourriture", "boisson", "traiteur",
    # TVA-DECLA-10-10-20 keywords
    "autoliquidation", "autoliquidee", "btp", "soustraitance", "soustraitant",
    "283", "nonies", "batiment", "travaux", "construction",
    # TVA-DECLA-20-20-50 keywords
    "oss", "guichet", "unique", "vente", "distance",
    "ecommerce", "electronique", "ioss", "10000", "trimestre",
    # TVA-DECLA-30-10-20 keywords
    "credit", "remboursement", "deductible", "semestrielle", "mensuel",
    "760", "exportateur", "exonere", "demande", "administration",
    # TVA-DECLA-20-20-40 keywords
    "deb", "des", "intracommunautaire", "echanges", "declaration",
    "statistique", "emebi", "service", "460000", "douane",
]

VOCAB_IDX = {w: i for i, w in enumerate(VOCAB)}
DIM = len(VOCAB)


def _keywords(text: str) -> set[str]:
    """Extract simple keyword tokens from text."""
    import re
    import unicodedata
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return set(re.split(r"[^a-z0-9.]+", text))


def _fake_embed(text: str) -> list[float]:
    """
    Return a normalised DIM-dimensional keyword-indicator vector.
    Words in VOCAB that appear in text get a 1.0; others 0.0.
    L2-normalised so cosine similarity works correctly.
    """
    vec = [0.0] * DIM
    tokens = _keywords(text)
    for token in tokens:
        if token in VOCAB_IDX:
            vec[VOCAB_IDX[token]] = 1.0
    # L2 normalise
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


class FakeEmbedder:
    dim = DIM

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_fake_embed(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return _fake_embed(text)


# ── Corpus loading ─────────────────────────────────────────────────────────

def load_corpus() -> list[dict]:
    """
    Parse the 5 BOFiP fixture HTML files and return chunk payloads,
    using the same logic as scripts/ingest_bofip.py.
    """
    # Import from the scripts module (relative to repo root)
    import sys
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    from ingest_bofip import parse_html, chunk_text

    payloads: list[dict] = []
    html_files = sorted(DOCS_DIR.glob("*.html"))
    assert html_files, f"No HTML files found in {DOCS_DIR}"

    for html_path in html_files:
        page = parse_html(html_path)
        chunks = chunk_text(page, chunk_tokens=500, overlap_tokens=50)
        for c in chunks:
            payloads.append({
                "text": c.text,
                "url": c.url,
                "title": c.title,
                "section_path": c.section_path,
                "last_updated": c.last_updated,
                "bofip_id": c.bofip_id,
                "chunk_index": c.chunk_index,
                "chunk_total": c.chunk_total,
            })

    return payloads


# ── Qdrant in-memory setup ─────────────────────────────────────────────────

@pytest.fixture(scope="module")
def retriever():
    """
    Build a BOFiPRetriever backed by in-memory Qdrant + fake embedder.
    Scope=module so we only build the index once.
    """
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct
    from src.rag.bofip_retriever import BOFiPRetriever, COLLECTION_NAME
    import uuid

    corpus = load_corpus()
    assert len(corpus) >= 5, "Expected at least 5 chunks from 5 HTML files"

    embedder = FakeEmbedder()

    # In-memory Qdrant
    client = QdrantClient(location=":memory:")
    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(size=DIM, distance=Distance.COSINE),
    )

    # Upsert all corpus chunks
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embedder.embed([c["text"]])[0],
            payload=c,
        )
        for c in corpus
    ]
    client.upsert(collection_name=COLLECTION_NAME, points=points)

    return BOFiPRetriever(
        qdrant_client=client,
        embedder=embedder,
        corpus_chunks=corpus,
        db_pool=None,
        collection_name=COLLECTION_NAME,
    )


# ── Helper ─────────────────────────────────────────────────────────────────

def top3_bofip_ids(retriever, query: str) -> list[str]:
    """Return the bofip_ids of the top-3 retrieved chunks."""
    chunks = retriever.retrieve(query, k=3)
    return [c.bofip_id for c in chunks]


def top3_urls(retriever, query: str) -> list[str]:
    """Return the URLs of the top-3 retrieved chunks."""
    chunks = retriever.retrieve(query, k=3)
    return [c.url for c in chunks]


# ── Corpus sanity tests ────────────────────────────────────────────────────


def test_corpus_loaded(retriever):
    """Corpus must contain chunks from all 5 BOFiP documents."""
    bofip_ids = {c["bofip_id"] for c in retriever._corpus}
    assert "BOI-TVA-LIQ-30" in bofip_ids, f"Missing BOI-TVA-LIQ-30, got: {bofip_ids}"
    assert "BOI-TVA-DECLA-10-10-20" in bofip_ids
    assert "BOI-TVA-DECLA-20-20-50" in bofip_ids
    assert "BOI-TVA-DECLA-30-10-20" in bofip_ids
    assert "BOI-TVA-DECLA-20-20-40" in bofip_ids


def test_bm25_index_non_empty(retriever):
    """BM25 index must return results for a French TVA query."""
    results = retriever._bm25.query("TVA restaurant taux réduit", top_k=5)
    assert len(results) > 0, "BM25 returned no results"
    assert all(score > 0 for _, score in results)


# ── Retrieval oracle tests ─────────────────────────────────────────────────


def test_q1_taux_reduit_restaurant(retriever):
    """Q1: 'Taux TVA réduit restaurant' → BOI-TVA-LIQ-30 in top-3."""
    ids = top3_bofip_ids(retriever, "Taux TVA réduit restaurant")
    assert "BOI-TVA-LIQ-30" in ids, (
        f"Expected BOI-TVA-LIQ-30 in top-3, got: {ids}"
    )


def test_q2_autoliquidation_btp(retriever):
    """Q2: 'TVA autoliquidation BTP sous-traitance' → BOI-TVA-DECLA-10-10-20 in top-3."""
    ids = top3_bofip_ids(retriever, "TVA autoliquidation BTP sous-traitance")
    assert "BOI-TVA-DECLA-10-10-20" in ids, (
        f"Expected BOI-TVA-DECLA-10-10-20 in top-3, got: {ids}"
    )


def test_q3_oss_guichet_unique(retriever):
    """Q3: 'OSS guichet unique TVA' → BOI-TVA-DECLA-20-20-50 in top-3."""
    ids = top3_bofip_ids(retriever, "OSS guichet unique TVA")
    assert "BOI-TVA-DECLA-20-20-50" in ids, (
        f"Expected BOI-TVA-DECLA-20-20-50 in top-3, got: {ids}"
    )


def test_q4_credit_tva_remboursement(retriever):
    """Q4: 'Crédit TVA remboursement' → BOI-TVA-DECLA-30-10-20 in top-3."""
    ids = top3_bofip_ids(retriever, "Crédit TVA remboursement")
    assert "BOI-TVA-DECLA-30-10-20" in ids, (
        f"Expected BOI-TVA-DECLA-30-10-20 in top-3, got: {ids}"
    )


def test_q5_deb_des_intracommunautaire(retriever):
    """Q5: 'DEB DES intracommunautaire' → BOI-TVA-DECLA-20-20-40 in top-3."""
    ids = top3_bofip_ids(retriever, "DEB DES intracommunautaire")
    assert "BOI-TVA-DECLA-20-20-40" in ids, (
        f"Expected BOI-TVA-DECLA-20-20-40 in top-3, got: {ids}"
    )


# ── Retrieval properties tests ─────────────────────────────────────────────


def test_retrieve_returns_k_results(retriever):
    """retrieve(k=3) must return exactly 3 chunks."""
    chunks = retriever.retrieve("TVA", k=3)
    assert len(chunks) == 3


def test_retrieve_chunks_have_required_fields(retriever):
    """Every chunk must have text, url, title, score."""
    chunks = retriever.retrieve("TVA collectée", k=5)
    for c in chunks:
        assert c.text, "chunk.text must be non-empty"
        assert c.url, "chunk.url must be non-empty"
        assert c.title, "chunk.title must be non-empty"
        assert c.score >= 0, "chunk.score must be >= 0"


def test_retrieve_scores_descending(retriever):
    """Scores must be in descending order."""
    chunks = retriever.retrieve("TVA déductible", k=5)
    scores = [c.score for c in chunks]
    assert scores == sorted(scores, reverse=True), f"Scores not sorted: {scores}"


def test_retrieve_no_api_key_needed(retriever):
    """Full pipeline runs offline (no VOYAGE_API_KEY required for tests)."""
    # If we got here, the fake embedder is working — test passes implicitly
    result = retriever.retrieve("autoliquidation sous-traitant BTP", k=3)
    assert len(result) > 0


def test_ingest_script_dry_run():
    """scripts/ingest_bofip.py --dry-run must parse all 5 HTML files without errors."""
    import subprocess, sys

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "ingest_bofip.py"), "--dry-run"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"ingest_bofip.py --dry-run failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )
    # Should mention chunked output for each file
    assert "BOI-TVA-LIQ-30" in result.stderr or "BOI-TVA-LIQ-30" in result.stdout


def test_rrf_fusion_deduplicates(retriever):
    """RRF fusion must not return the same chunk twice."""
    chunks = retriever.retrieve("TVA restaurant taux réduit", k=5)
    urls_and_idx = [(c.url, c.chunk_index) for c in chunks]
    assert len(urls_and_idx) == len(set(urls_and_idx)), "Duplicate chunks returned"
