#!/usr/bin/env python3
"""
ingest_bofip.py — BOFiP-TVA ingestion pipeline.

Reads HTML files from docs/bofip_tva/, extracts text and metadata,
chunks at 1000 tokens / 100-token overlap, embeds with voyage-3
(fallback: sentence-transformers), stores in Qdrant collection 'bofip_tva_fr'.

Usage:
  python scripts/ingest_bofip.py [--docs-dir docs/bofip_tva] [--qdrant-url http://localhost:6333]
  python scripts/ingest_bofip.py --dry-run   # parse + chunk only, no embedding/storage

Environment variables:
  VOYAGE_API_KEY         — voyage-3 API key (primary embedder)
  QDRANT_URL             — Qdrant server URL (default: http://localhost:6333)
  QDRANT_API_KEY         — Qdrant API key (optional)

Robots.txt compliance:
  bofip.impots.gouv.fr robots.txt (checked 2025-05-31):
    - /bofip/ paths are NOT disallowed
    - Crawl-delay: none specified
  Live download (optional) respects a 2-second delay between requests.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── Dependency imports ──────────────────────────────────────────────────────

try:
    import tiktoken
except ImportError:
    sys.exit("Missing: pip install tiktoken")

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing: pip install beautifulsoup4 lxml")

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance,
        VectorParams,
        PointStruct,
        Filter,
        FieldCondition,
        MatchValue,
    )
except ImportError:
    sys.exit("Missing: pip install qdrant-client")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent
COLLECTION_NAME = "bofip_tva_fr"
CHUNK_TOKENS = 1000
OVERLAP_TOKENS = 100
VECTOR_DIM_VOYAGE = 1024       # voyage-3 output dimension
VECTOR_DIM_SBERT = 768         # paraphrase-multilingual-mpnet-base-v2 dimension
BOFIP_BASE_URL = "https://bofip.impots.gouv.fr"
CRAWL_DELAY_SECONDS = 2.0


# ── Data models ─────────────────────────────────────────────────────────────

@dataclass
class ParsedPage:
    url: str
    title: str
    last_updated: str
    body_text: str
    section_path: str
    bofip_id: str


@dataclass
class Chunk:
    text: str
    url: str
    title: str
    section_path: str
    last_updated: str
    bofip_id: str
    chunk_index: int
    chunk_total: int


# ── HTML Parser ─────────────────────────────────────────────────────────────

def parse_html(html_path: Path) -> ParsedPage:
    """Extract structured content from a BOFiP HTML file."""
    with open(html_path, encoding="utf-8") as fh:
        soup = BeautifulSoup(fh.read(), "lxml")

    # Extract metadata from <meta> tags
    def meta(name: str) -> str:
        tag = soup.find("meta", {"name": name})
        return tag["content"].strip() if tag and tag.get("content") else ""

    bofip_id = meta("bofip-id") or html_path.stem
    section_path = meta("section-path")
    last_updated = meta("last-updated")

    # Title
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else html_path.stem

    # Reconstruct URL from bofip-id
    if bofip_id:
        url = f"{BOFIP_BASE_URL}/bofip/recherche-bofip.html?identifiant={bofip_id}"
    else:
        url = f"{BOFIP_BASE_URL}/bofip/{html_path.stem}"

    # Remove script, style, nav, head
    for tag in soup(["script", "style", "head", "nav"]):
        tag.decompose()

    # Extract body text preserving paragraph structure
    body = soup.find("body") or soup
    paragraphs = []
    for elem in body.find_all(["h1", "h2", "h3", "h4", "p", "li"]):
        text = elem.get_text(separator=" ", strip=True)
        if text:
            paragraphs.append(text)

    body_text = "\n\n".join(paragraphs)

    return ParsedPage(
        url=url,
        title=title,
        last_updated=last_updated or datetime.now().strftime("%Y-%m-%d"),
        body_text=body_text,
        section_path=section_path,
        bofip_id=bofip_id,
    )


# ── Chunker ─────────────────────────────────────────────────────────────────

def chunk_text(
    page: ParsedPage,
    chunk_tokens: int = CHUNK_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> list[Chunk]:
    """
    Split page body_text into overlapping chunks of ~chunk_tokens tokens.
    Uses tiktoken (cl100k_base encoding, compatible with most modern LLMs).
    """
    enc = tiktoken.get_encoding("cl100k_base")
    tokens = enc.encode(page.body_text)

    if not tokens:
        return []

    chunks: list[Chunk] = []
    start = 0
    chunk_idx = 0

    while start < len(tokens):
        end = min(start + chunk_tokens, len(tokens))
        chunk_tokens_slice = tokens[start:end]
        chunk_text_str = enc.decode(chunk_tokens_slice)

        chunks.append(Chunk(
            text=chunk_text_str,
            url=page.url,
            title=page.title,
            section_path=page.section_path,
            last_updated=page.last_updated,
            bofip_id=page.bofip_id,
            chunk_index=chunk_idx,
            chunk_total=0,  # filled in below
        ))
        chunk_idx += 1

        if end == len(tokens):
            break
        start = end - overlap_tokens

    # Fill in chunk_total
    total = len(chunks)
    for c in chunks:
        c.chunk_total = total

    logger.info(
        "Chunked '%s' → %d chunks (avg %.0f tokens)",
        page.bofip_id, total,
        len(tokens) / max(total, 1),
    )
    return chunks


# ── Embedder ────────────────────────────────────────────────────────────────

class VoyageEmbedder:
    """Primary: Anthropic voyage-3 via voyageai SDK."""

    def __init__(self, api_key: str) -> None:
        import voyageai
        self._client = voyageai.Client(api_key=api_key)
        self.dim = VECTOR_DIM_VOYAGE

    def embed(self, texts: list[str]) -> list[list[float]]:
        result = self._client.embed(texts, model="voyage-3", input_type="document")
        return result.embeddings

    def embed_query(self, text: str) -> list[float]:
        result = self._client.embed([text], model="voyage-3", input_type="query")
        return result.embeddings[0]


class SBertEmbedder:
    """Fallback: sentence-transformers (no API key needed, local model)."""

    MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"

    def __init__(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            sys.exit("Missing fallback embedder: pip install sentence-transformers")
        logger.info("Loading SentenceTransformer model '%s' …", self.MODEL)
        self._model = SentenceTransformer(self.MODEL)
        self.dim = VECTOR_DIM_SBERT

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts, convert_to_numpy=True).tolist()

    def embed_query(self, text: str) -> list[float]:
        return self._model.encode([text], convert_to_numpy=True)[0].tolist()


def build_embedder(voyage_api_key: Optional[str] = None):
    """Return VoyageEmbedder if VOYAGE_API_KEY is available, else SBertEmbedder."""
    key = voyage_api_key or os.getenv("VOYAGE_API_KEY")
    if key:
        logger.info("Using voyage-3 embedder.")
        return VoyageEmbedder(api_key=key)
    logger.warning("VOYAGE_API_KEY not set — falling back to sentence-transformers.")
    return SBertEmbedder()


# ── Qdrant storage ──────────────────────────────────────────────────────────

def get_or_create_collection(client: QdrantClient, dim: int) -> None:
    """Ensure the Qdrant collection exists with correct vector dimensions."""
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in existing:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
        logger.info("Created Qdrant collection '%s' (dim=%d).", COLLECTION_NAME, dim)
    else:
        logger.info("Qdrant collection '%s' already exists.", COLLECTION_NAME)


def store_chunks(
    client: QdrantClient,
    chunks: list[Chunk],
    embeddings: list[list[float]],
    batch_size: int = 100,
) -> None:
    """Upsert chunk embeddings + payloads into Qdrant."""
    import uuid

    points = [
        PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{c.url}|{c.chunk_index}")),
            vector=emb,
            payload={
                "text": c.text,
                "url": c.url,
                "title": c.title,
                "section_path": c.section_path,
                "last_updated": c.last_updated,
                "bofip_id": c.bofip_id,
                "chunk_index": c.chunk_index,
                "chunk_total": c.chunk_total,
            },
        )
        for c, emb in zip(chunks, embeddings)
    ]

    for i in range(0, len(points), batch_size):
        batch = points[i : i + batch_size]
        client.upsert(collection_name=COLLECTION_NAME, points=batch)
        logger.info("Upserted batch %d/%d (%d points).", i // batch_size + 1,
                    (len(points) + batch_size - 1) // batch_size, len(batch))


# ── Live download (optional) ────────────────────────────────────────────────

def download_bofip_pages(bofip_ids: list[str], output_dir: Path) -> None:
    """
    Attempt to download BOFiP pages by identifier.
    Respects robots.txt (paths not disallowed) and crawl delay.
    """
    import urllib.request
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; Stratus-Research-Bot/1.0; "
            "fiscal-compliance research; contact: research@stratus.ai)"
        )
    }
    output_dir.mkdir(parents=True, exist_ok=True)

    for boi_id in bofip_ids:
        out_file = output_dir / f"{boi_id}.html"
        if out_file.exists():
            logger.info("Already downloaded: %s", out_file.name)
            continue

        # BOFiP search URL with identifier
        url = f"{BOFIP_BASE_URL}/bofip/recherche-bofip.html?identifiant={boi_id}"
        logger.info("Downloading %s …", url)
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                content = resp.read()
            out_file.write_bytes(content)
            logger.info("Saved %s (%d bytes).", out_file.name, len(content))
        except Exception as exc:
            logger.warning("Failed to download %s: %s", boi_id, exc)

        time.sleep(CRAWL_DELAY_SECONDS)


# ── Main ────────────────────────────────────────────────────────────────────

DEFAULT_BOFIP_IDS = [
    "BOI-TVA-LIQ-30",
    "BOI-TVA-LIQ-30-10",
    "BOI-TVA-LIQ-30-20",
    "BOI-TVA-DECLA-10-10-20",
    "BOI-TVA-DECLA-20-20-40",
    "BOI-TVA-DECLA-20-20-50",
    "BOI-TVA-DECLA-30-10-20",
    "BOI-TVA-CHAMP",
    "BOI-TVA-BASE",
    "BOI-TVA-DED",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest BOFiP-TVA HTML into Qdrant.")
    parser.add_argument(
        "--docs-dir",
        default=str(REPO_ROOT / "docs" / "bofip_tva"),
        help="Path to directory with BOFiP HTML files.",
    )
    parser.add_argument(
        "--qdrant-url",
        default=os.getenv("QDRANT_URL", "http://localhost:6333"),
        help="Qdrant server URL.",
    )
    parser.add_argument(
        "--qdrant-api-key",
        default=os.getenv("QDRANT_API_KEY"),
        help="Qdrant API key (optional).",
    )
    parser.add_argument(
        "--voyage-api-key",
        default=os.getenv("VOYAGE_API_KEY"),
        help="Voyage AI API key.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and chunk only — do not embed or store.",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Attempt live download of BOFiP pages before ingestion.",
    )
    args = parser.parse_args()

    docs_dir = Path(args.docs_dir)

    # Optionally download
    if args.download:
        download_bofip_pages(DEFAULT_BOFIP_IDS, docs_dir)

    # Collect HTML files
    html_files = sorted(docs_dir.glob("*.html"))
    if not html_files:
        logger.error("No HTML files found in %s. Run with --download to fetch them.", docs_dir)
        sys.exit(1)
    logger.info("Found %d HTML files in %s.", len(html_files), docs_dir)

    # Parse + chunk
    all_chunks: list[Chunk] = []
    for html_path in html_files:
        try:
            page = parse_html(html_path)
            chunks = chunk_text(page)
            all_chunks.extend(chunks)
            logger.info("Parsed '%s': %d chunks.", html_path.name, len(chunks))
        except Exception as exc:
            logger.error("Failed to parse %s: %s", html_path.name, exc)

    logger.info("Total chunks: %d", len(all_chunks))

    if args.dry_run:
        logger.info("Dry-run: stopping before embedding/storage.")
        # Print summary
        for c in all_chunks[:3]:
            print(f"\n--- {c.bofip_id} chunk {c.chunk_index}/{c.chunk_total} ---")
            print(c.text[:300])
        return

    # Embed
    embedder = build_embedder(args.voyage_api_key)
    texts = [c.text for c in all_chunks]
    logger.info("Embedding %d chunks with %s …", len(texts), embedder.__class__.__name__)

    # Embed in batches of 50 to avoid API limits
    all_embeddings: list[list[float]] = []
    EMBED_BATCH = 50
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        embs = embedder.embed(batch)
        all_embeddings.extend(embs)
        logger.info("Embedded %d/%d", min(i + EMBED_BATCH, len(texts)), len(texts))

    # Store in Qdrant
    client = QdrantClient(
        url=args.qdrant_url,
        api_key=args.qdrant_api_key,
        timeout=30,
    )
    get_or_create_collection(client, dim=embedder.dim)
    store_chunks(client, all_chunks, all_embeddings)

    logger.info("Ingestion complete: %d chunks stored in '%s'.", len(all_chunks), COLLECTION_NAME)


if __name__ == "__main__":
    main()
