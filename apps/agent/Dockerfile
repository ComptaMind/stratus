# ── Stage 1: builder ───────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Install uv for fast dependency resolution
RUN pip install --no-cache-dir uv==0.5.18

COPY pyproject.toml requirements.txt ./

# Create a virtual environment and install dependencies
RUN uv venv /opt/venv && \
    . /opt/venv/bin/activate && \
    uv pip install --no-cache -r requirements.txt

# ── Stage 2: runner ────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"

RUN addgroup --system --gid 1001 stratus && \
    adduser  --system --uid 1001 --ingroup stratus stratus

COPY --from=builder /opt/venv /opt/venv
COPY --chown=stratus:stratus . .

USER stratus

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
