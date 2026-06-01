"""
PII scrubber for LLM inputs.

Scrubs SIRET (14-digit), SIREN (9-digit), and natural-person names before
sending prompts to any LLM. Pseudo-IDs are stored per session in Redis
(TTL 1h) so the caller can reverse them in responses if needed.

Falls back to an in-process dict if Redis is unavailable.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# ── Regex patterns ────────────────────────────────────────────────────────────

# SIRET: 14 digits optionally split by spaces/dashes
# Must run BEFORE SIREN to avoid partial matches
_SIRET_RE = re.compile(
    r"\b\d{3}[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{5}\b"
)

# SIREN: 9 digits optionally split by spaces/dashes
_SIREN_RE = re.compile(
    r"\b\d{3}[\s\-]?\d{3}[\s\-]?\d{3}\b"
)

# Natural persons: honorific + capitalized name (best-effort)
_PERSON_RE = re.compile(
    r"\b(?:M\.|Mme\.?|Monsieur|Madame|M(?=\s))\s+"
    r"[A-ZÀÂÆÇÉÈÊËÎÏÔÙÛÜŒ][a-zàâæçéèêëîïôùûüœ]+"
    r"(?:\s+[A-ZÀÂÆÇÉÈÊËÎÏÔÙÛÜŒ][a-zàâæçéèêëîïôùûüœ]+)*"
)


def _pseudo(original: str, prefix: str) -> str:
    h = hashlib.sha256(original.encode()).hexdigest()[:8]
    return f"{prefix}-PSEUDO-{h}"


class PIIScrubber:
    """
    Scrubs PII from text before LLM calls.

    Parameters
    ----------
    redis_client : optional redis.asyncio.Redis
        When provided, pseudo-ID maps are persisted in Redis with TTL=1h.
        When absent, an in-process dict is used (dev / test mode).
    """

    def __init__(self, redis_client=None) -> None:
        self._redis = redis_client
        self._local: dict[str, dict[str, str]] = {}  # session_id → {original: pseudo}

    async def scrub(self, text: str, session_id: str) -> tuple[str, dict[str, str]]:
        """
        Return (scrubbed_text, pseudo_map).

        The pseudo_map maps original PII values to their pseudo-IDs, useful
        for reversing replacements in LLM responses.
        """
        pseudo_map = await self._load(session_id)

        def replace_siret(m: re.Match) -> str:  # type: ignore[type-arg]
            orig = m.group(0)
            if orig not in pseudo_map:
                pseudo_map[orig] = _pseudo(orig, "SIRET")
            return pseudo_map[orig]

        def replace_siren(m: re.Match) -> str:  # type: ignore[type-arg]
            orig = m.group(0)
            if orig not in pseudo_map:
                pseudo_map[orig] = _pseudo(orig, "SIREN")
            return pseudo_map[orig]

        def replace_person(m: re.Match) -> str:  # type: ignore[type-arg]
            orig = m.group(0)
            if orig not in pseudo_map:
                pseudo_map[orig] = _pseudo(orig, "PERSON")
            return pseudo_map[orig]

        # Order matters: SIRET first (longer) then SIREN
        text = _SIRET_RE.sub(replace_siret, text)
        text = _SIREN_RE.sub(replace_siren, text)
        text = _PERSON_RE.sub(replace_person, text)

        await self._save(session_id, pseudo_map)
        return text, pseudo_map

    # ── Storage helpers ───────────────────────────────────────────────────────

    async def _load(self, session_id: str) -> dict[str, str]:
        if self._redis is not None:
            try:
                raw = await self._redis.get(f"pii_map:{session_id}")
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                logger.warning("Redis load failed: %s — using in-memory map", exc)
        return dict(self._local.get(session_id, {}))

    async def _save(self, session_id: str, pseudo_map: dict[str, str]) -> None:
        if self._redis is not None:
            try:
                await self._redis.set(
                    f"pii_map:{session_id}",
                    json.dumps(pseudo_map),
                    ex=3600,  # TTL 1 hour
                )
                return
            except Exception as exc:
                logger.warning("Redis save failed: %s — using in-memory map", exc)
        self._local[session_id] = pseudo_map
