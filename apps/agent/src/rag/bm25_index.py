"""
BM25 sparse index for the BOFiP RAG layer.

Uses rank-bm25 (BM25Okapi) with French-aware tokenisation:
  - lowercase
  - remove accents (unicode NFKD normalisation)
  - split on whitespace/punctuation
  - stop-word removal (French)

Index is built in-memory at retriever initialisation from the corpus chunks.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from typing import Optional

logger = logging.getLogger(__name__)

# Minimal French stop-words list
_FR_STOPWORDS = frozenset([
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "à",
    "au", "aux", "est", "par", "pour", "dans", "sur", "ou", "qui", "que",
    "qu", "ce", "se", "sa", "son", "ses", "leur", "leurs", "il", "ils",
    "elle", "elles", "nous", "vous", "on", "ne", "pas", "plus", "bien",
    "très", "cette", "cet", "ces", "être", "avoir", "fait", "peut", "doit",
    "sont", "ont", "été", "si", "aussi", "comme", "lors", "dont", "avec",
    "lors", "lorsque", "même", "tout", "toute", "tous", "toutes", "donc",
    "mais", "car", "ni", "or", "puis", "ainsi", "entre", "sous", "selon",
])


def _tokenise(text: str) -> list[str]:
    """Lowercase, strip accents, split, remove stop-words and short tokens."""
    # Normalise unicode → ASCII approximation for accent removal
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    # Split on non-alphanumeric
    tokens = re.split(r"[^a-z0-9]+", text)
    return [t for t in tokens if len(t) > 2 and t not in _FR_STOPWORDS]


class BM25Index:
    """
    In-memory BM25 index over a list of text documents.

    Parameters
    ----------
    texts : list[str]
        Corpus documents (same order as original chunk list).
    """

    def __init__(self, texts: list[str]) -> None:
        try:
            from rank_bm25 import BM25Okapi
        except ImportError:
            raise ImportError("pip install rank-bm25")

        self._corpus_tokens = [_tokenise(t) for t in texts]
        self._bm25 = BM25Okapi(self._corpus_tokens)
        logger.debug("BM25 index built over %d documents.", len(texts))

    def query(self, text: str, top_k: int = 20) -> list[tuple[int, float]]:
        """
        Return (index, score) pairs for the top_k highest-scoring documents.
        Scores are raw BM25 values (not normalised).
        """
        q_tokens = _tokenise(text)
        if not q_tokens:
            return []
        scores = self._bm25.get_scores(q_tokens)
        # Sort descending, return top_k with positive scores
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        return [(idx, float(score)) for idx, score in ranked[:top_k] if score > 0.0]
