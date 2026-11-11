# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Image bon.kerlam.fr — FastAPI + WeasyPrint, utilisateur non-root, HEALTHCHECK.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS base

# Dépendances système de WeasyPrint (Pango, cairo, gdk-pixbuf, polices) + curl
# pour le HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libcairo2 \
        libffi8 \
        shared-mime-info \
        fonts-dejavu-core \
        curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dépendances Python d'abord (cache de couche).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Code applicatif.
COPY VERSION ./VERSION
COPY app ./app
COPY frontend ./frontend

# Version et SHA injectés au build.
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=dev
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    APP_ENV=production \
    DATA_DIR=/data

# Volume des données SQLite (WAL).
RUN mkdir -p /data && useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app /data
VOLUME ["/data"]

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
