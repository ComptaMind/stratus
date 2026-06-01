"""
Stratus Agent — FastAPI entry point.
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from pydantic import BaseModel

# Sentry — initialise before anything else so all exceptions are captured.
_SENTRY_DSN = os.getenv("SENTRY_DSN")
if _SENTRY_DSN:
    import sentry_sdk
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        environment=os.getenv("APP_ENV", "development"),
        traces_sample_rate=0.2 if os.getenv("APP_ENV") == "production" else 1.0,
        release=os.getenv("GIT_COMMIT_SHA", "local"),
    )

from src.api.v1.llm import router as llm_router
from src.api.v1.classify import router as classify_router
from src.api.v1.agent import router as agent_router

app = FastAPI(
    title="Stratus Agent",
    description="AI fiscal agent for French VAT compliance",
    version="0.2.0",
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(llm_router)
app.include_router(classify_router)
app.include_router(agent_router)


# ── Health ────────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Liveness probe — returns {status: 'ok'}."""
    return HealthResponse(status="ok")


# ── Stubs (to be implemented in upcoming sprints) ─────────────────────────────


class FecClassifyRequest(BaseModel):
    fec_content: str
    """Raw FEC file content (pipe-delimited)."""


class Ca3ComputeRequest(BaseModel):
    fiscal_year: str
    month: int


@app.post("/fec/classify", tags=["fec"], status_code=501)
async def classify_fec(_body: FecClassifyRequest) -> dict:
    """Classify VAT entries in a FEC file. — Not yet implemented."""
    return {"detail": "Not implemented — sprint 2"}


@app.post("/ca3/compute", tags=["ca3"], status_code=501)
async def compute_ca3(_body: Ca3ComputeRequest) -> dict:
    """Compute CA3 monthly VAT declaration. — Not yet implemented."""
    return {"detail": "Not implemented — sprint 3"}


@app.post("/edi/export", tags=["edi"], status_code=501)
async def export_edi_tva() -> dict:
    """Generate official EDI-TVA XML. — Not yet implemented."""
    return {"detail": "Not implemented — sprint 4"}
