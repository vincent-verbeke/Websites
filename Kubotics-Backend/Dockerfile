# Multi-stage production Dockerfile for Kubotics FastAPI Backend
# Runs Python 3.14 on Linux with unprivileged execution

FROM python:3.14-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for rapid package resolution
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Create venv and install dependencies
ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml README.md ./
RUN uv venv --python 3.14 $VIRTUAL_ENV && \
    uv pip install setuptools && \
    uv pip install --no-build-isolation -e .

# -----------------------------------------------------------------------------
# Runtime stage
# -----------------------------------------------------------------------------
FROM python:3.14-slim AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

# Copy virtualenv and application code
COPY --from=builder /app/.venv /app/.venv
COPY src /app/src
COPY run.py /app/run.py

ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH=/app/src
ENV PORT=8000

USER appuser

# Healthcheck for AWS Application Load Balancer
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "src"]
