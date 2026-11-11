"""Point d'entrée FastAPI de bon.kerlam.fr.

Responsabilités : appliquer les migrations au démarrage, injecter la version dans
le shell HTML et dans l'URL des assets (`?v=<version>`), exposer /api/health,
/api/version et l'API v1 (OpenAPI sur /api/docs), servir la PWA.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .api import authn, v1
from .config import get_settings

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
VERSION_TOKEN = "__APP_VERSION__"

# Fichiers du shell servis avec substitution de version et sans cache.
NO_CACHE_FILES = {
    "index.html": "text/html; charset=utf-8",
    "sw.js": "application/javascript; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json",
    "assets/app-version.js": "application/javascript; charset=utf-8",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    db.run_migrations(settings.db_path)
    if not settings.is_production and os.environ.get("SEED_DEV", "1") != "0":
        from .seed import seed_if_empty

        seed_if_empty(settings.db_path)
    yield


def _render_with_version(path: Path, version: str) -> str:
    return path.read_text(encoding="utf-8").replace(VERSION_TOKEN, version)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="bon.kerlam.fr — Lettres de voiture KERLAM",
        version=settings.app_version,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings

    @app.middleware("http")
    async def version_header(request: Request, call_next):
        # Comparaison de version client (en-tête X-App-Version) : en mode strict,
        # on demande un rechargement si le client est périmé (hook désactivé par défaut).
        client_version = request.headers.get("x-app-version")
        strict = os.environ.get("BON_STRICT_CLIENT_VERSION", "").lower() in {"1", "true", "yes"}
        if (
            strict
            and client_version
            and client_version != settings.app_version
            and request.url.path.startswith("/api/")
        ):
            return JSONResponse(
                {"detail": "Version client périmée", "required": settings.app_version},
                status_code=426,
                headers={"X-App-Version": settings.app_version},
            )
        response = await call_next(request)
        response.headers["X-App-Version"] = settings.app_version
        return response

    # --- Endpoints techniques ---
    @app.get("/api/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/version", tags=["meta"])
    def version() -> dict[str, object]:
        return {
            "version": settings.app_version,
            "sha": settings.git_sha,
            "schema_version": db.schema_version(settings.db_path),
        }

    app.include_router(v1.router)
    app.include_router(authn.router, prefix="/api")

    # --- Shell PWA (substitution de version + no-cache) ---
    @app.get("/", include_in_schema=False)
    def index() -> Response:
        html = _render_with_version(FRONTEND_DIR / "index.html", settings.app_version)
        return Response(
            content=html, media_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )

    @app.get("/{filename}", include_in_schema=False)
    def shell_file(filename: str) -> Response:
        if filename in NO_CACHE_FILES:
            target = FRONTEND_DIR / filename
            if target.exists():
                content = _render_with_version(target, settings.app_version)
                return Response(
                    content=content, media_type=NO_CACHE_FILES[filename],
                    headers={"Cache-Control": "no-cache, must-revalidate"},
                )
        return Response(status_code=404)

    @app.get("/assets/app-version.js", include_in_schema=False)
    def app_version_js() -> Response:
        content = _render_with_version(FRONTEND_DIR / "assets" / "app-version.js", settings.app_version)
        return Response(
            content=content, media_type="application/javascript; charset=utf-8",
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )

    # Autres assets versionnés (?v=...) servis en statique (cache géré par nginx en prod).
    if (FRONTEND_DIR / "assets").exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    return app


app = create_app()
