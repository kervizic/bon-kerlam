"""Configuration via variables d'environnement (12-factor)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


def _read_version() -> str:
    env = os.environ.get("APP_VERSION")
    if env:
        return env.strip()
    vfile = ROOT / "VERSION"
    if vfile.exists():
        return vfile.read_text(encoding="utf-8").strip()
    return "0.0.0-dev"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # Identité / version
    app_version: str = _read_version()
    git_sha: str = os.environ.get("GIT_SHA", "dev")
    app_env: str = os.environ.get("APP_ENV", "dev")  # dev | production

    # Transporteur (jamais en dur dans le code métier)
    carrier_name: str = "KERLAM"
    carrier_address: str = "15 Rue Victor Drouet, 77410 Claye-Souilly"
    carrier_siren: str = os.environ.get("CARRIER_SIREN", "000000000")

    # Numérotation des lettres de voiture
    lv_number_prefix: str = "KER-"
    lv_number_start: int = 3000
    lv_number_width: int = 5

    # Base de données
    data_dir: Path = Path(os.environ.get("DATA_DIR", str(ROOT / "data")))

    @property
    def db_path(self) -> Path:
        return self.data_dir / "bon.db"

    # Session / cookies
    session_secret: str = os.environ.get("SESSION_SECRET", "dev-insecure-secret-change-me")
    cookie_secure: bool = os.environ.get("COOKIE_SECURE", "").lower() in {"1", "true", "yes"}

    # OIDC
    oidc_issuer: str = os.environ.get("OIDC_ISSUER", "")
    oidc_client_id: str = os.environ.get("OIDC_CLIENT_ID", "")
    oidc_client_secret: str = os.environ.get("OIDC_CLIENT_SECRET", "")
    oidc_redirect_uri: str = os.environ.get("OIDC_REDIRECT_URI", "")
    oidc_groups_claim: str = os.environ.get("OIDC_GROUPS_CLAIM", "groups")
    oidc_group_bureau: str = os.environ.get("OIDC_GROUP_BUREAU", "bon-bureau")
    oidc_group_chauffeur: str = os.environ.get("OIDC_GROUP_CHAUFFEUR", "bon-chauffeur")

    # Connexion de développement (refusée en production)
    dev_login: bool = os.environ.get("DEV_LOGIN", "").lower() in {"1", "true", "yes"}

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def dev_login_enabled(self) -> bool:
        return self.dev_login and not self.is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()
