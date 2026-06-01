from __future__ import annotations

from typing import Optional
from pydantic import BaseModel

# ── Model routing ─────────────────────────────────────────────────────────────

ANTHROPIC_MODEL_HINTS: dict[str, str] = {
    "classify": "claude-haiku-4-5-20251001",
    "reason": "claude-sonnet-4-6",
    "reason_hard": "claude-opus-4-6",
}
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
MISTRAL_FALLBACK_MODEL = "mistral-large-latest"

# ── Cost table (USD per 1M tokens) ────────────────────────────────────────────

COST_USD_PER_1M: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5-20251001": {"input": 0.25, "output": 1.25},
    "claude-opus-4-6": {"input": 15.0, "output": 75.0},
    "mistral-large-latest": {"input": 2.0, "output": 6.0},
}

USD_TO_EUR: float = 0.92


def compute_cost_eur(model: str, input_tokens: int, output_tokens: int) -> float:
    costs = COST_USD_PER_1M.get(model, {"input": 3.0, "output": 15.0})
    usd = (input_tokens * costs["input"] + output_tokens * costs["output"]) / 1_000_000
    return round(usd * USD_TO_EUR, 6)


# ── Response schema ───────────────────────────────────────────────────────────

class LLMResponse(BaseModel):
    content: str
    model_used: str
    input_tokens: int
    output_tokens: int
    latency_ms: int
    fallback_used: bool


# ── Request schema (FastAPI endpoint) ─────────────────────────────────────────

class LLMCompleteRequest(BaseModel):
    prompt: str
    system: str = ""
    tools: Optional[list] = None
    model_hint: Optional[str] = None
    session_id: str = "default"
    organization_id: Optional[str] = None
