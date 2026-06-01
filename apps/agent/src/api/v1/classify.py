"""
POST /v1/fec-imports/{import_id}/classify — VAT classification endpoint.

Accepts a list of FEC entry rows and returns VAT classification for each
in-scope account (44x, 6xx, 7xx).  Out-of-scope accounts are silently
ignored.  Results are also persisted to the vat_classifications DB table.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...classifier.vat_classifier import VATClassifier, FECEntryInput, VATClassificationResult
from ...llm.gateway import LLMGateway
from ...llm.pii_scrubber import PIIScrubber
from ...llm.tracing import LLMTracer

router = APIRouter(prefix="/v1/fec-imports", tags=["classify"])

# ── Singleton ────────────────────────────────────────────────────────────────

_classifier: Optional[VATClassifier] = None


def _get_classifier() -> VATClassifier:
    global _classifier
    if _classifier is None:
        scrubber = PIIScrubber()
        tracer = LLMTracer(dsn=os.getenv("DATABASE_URL"))
        gateway = LLMGateway(
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            mistral_api_key=os.getenv("MISTRAL_API_KEY"),
            scrubber=scrubber,
            tracer=tracer,
        )
        _classifier = VATClassifier(
            gateway=gateway,
            dsn=os.getenv("DATABASE_URL"),
        )
    return _classifier


# ── Request / Response models ────────────────────────────────────────────────


class FECEntryDTO(BaseModel):
    ecriture_num: str
    compte_num: str
    compte_lib: str = ""
    ecriture_lib: str = ""
    debit: float = 0.0
    credit: float = 0.0
    journal_code: str = ""
    piece_ref: str = ""


class ClassifyRequest(BaseModel):
    entries: list[FECEntryDTO]
    organization_id: Optional[str] = None
    session_id: str = Field(default="default")


class ClassificationResultDTO(BaseModel):
    ecriture_num: str
    compte_num: str
    compte_lib: str
    ecriture_lib: str
    debit: float
    credit: float
    vat_type: str
    confidence: float
    method: str
    llm_reasoning: Optional[str] = None
    error: Optional[str] = None


class ClassifyResponse(BaseModel):
    import_id: str
    total_entries: int
    classified: int
    results: list[ClassificationResultDTO]


# ── Endpoint ─────────────────────────────────────────────────────────────────


@router.post(
    "/{import_id}/classify",
    response_model=ClassifyResponse,
    summary="Classify FEC entries by VAT type",
)
async def classify_fec_import(
    import_id: str,
    body: ClassifyRequest,
    classifier: VATClassifier = Depends(_get_classifier),
) -> ClassifyResponse:
    """
    Classify VAT type for each FEC entry in the request body.

    - **deterministic**: accounts 44x, standard 6xx/7xx → instant rule match
    - **LLM**: ambiguous or unknown accounts → Claude Haiku 4.5

    Results are persisted to `vat_classifications` table.
    """
    entries = [
        FECEntryInput(
            ecriture_num=e.ecriture_num,
            compte_num=e.compte_num,
            compte_lib=e.compte_lib,
            ecriture_lib=e.ecriture_lib,
            debit=e.debit,
            credit=e.credit,
            journal_code=e.journal_code,
            piece_ref=e.piece_ref,
        )
        for e in body.entries
    ]

    try:
        results = await classifier.classify(
            entries=entries,
            fec_import_id=import_id,
            organization_id=body.organization_id,
            session_id=body.session_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    dtos = [
        ClassificationResultDTO(
            ecriture_num=r.ecriture_num,
            compte_num=r.compte_num,
            compte_lib=r.compte_lib,
            ecriture_lib=r.ecriture_lib,
            debit=r.debit,
            credit=r.credit,
            vat_type=r.vat_type,
            confidence=r.confidence,
            method=r.method,
            llm_reasoning=r.llm_reasoning,
            error=r.error,
        )
        for r in results
    ]

    return ClassifyResponse(
        import_id=import_id,
        total_entries=len(body.entries),
        classified=len(dtos),
        results=dtos,
    )
