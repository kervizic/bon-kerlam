"""Configuration du worker, depuis l'environnement (aucun secret en dur)."""

from __future__ import annotations

import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]


def _version() -> str:
    v = os.environ.get("APP_VERSION")
    if v:
        return v
    f = _ROOT / "VERSION"
    if f.exists():
        return f.read_text(encoding="utf-8").strip()
    return "0.0.0-dev"


class Settings:
    version: str = _version()
    git_sha: str = os.environ.get("GIT_SHA", "unknown")
    # Connexion Postgres (rôle bon_worker en prod ; superuser en CI).
    database_url: str = os.environ.get("WORKER_DATABASE_URL") or os.environ.get(
        "DATABASE_URL", ""
    )
    # Géocodage BAN au démarrage (désactivable en test).
    geocode_on_start: bool = os.environ.get("GEOCODE_ON_START", "false").lower() == "true"
    ban_url: str = os.environ.get("BAN_URL", "https://api-adresse.data.gouv.fr/search/")
    # Storage (scans documents chauffeur) : URL interne + clé service_role.
    storage_url: str = os.environ.get("STORAGE_URL", "http://storage:5000")
    service_role_key: str = os.environ.get("SERVICE_ROLE_KEY", "")
    docs_bucket: str = os.environ.get("DOCS_BUCKET", "chauffeur-docs")


settings = Settings()
