"""Authentification : session par cookie signé, DEV_LOGIN, OIDC (PKCE), jetons d'API.

Le rôle (`bureau` / `chauffeur`) est déduit du claim `groups` de l'OIDC. Un jeton
d'API haché (portée lecture/écriture) peut authentifier les appels machine ; toute
action réalisée avec un jeton IA est marquée « via IA ».
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass

from itsdangerous import BadSignature, URLSafeSerializer

from .config import Settings
from .roles import role_from_groups

SESSION_COOKIE = "bon_session"


@dataclass
class Principal:
    """Utilisateur courant (humain via session, ou machine via jeton d'API)."""

    subject: str
    label: str
    role: str  # bureau | chauffeur
    email: str | None = None
    chauffeur_id: int | None = None
    via_ia: bool = False
    scope: str = "write"  # read | write

    @property
    def actor_key(self) -> str:
        return self.subject


def _serializer(settings: Settings) -> URLSafeSerializer:
    return URLSafeSerializer(settings.session_secret, salt="bon-session")


def make_session_cookie(settings: Settings, data: dict) -> str:
    return _serializer(settings).dumps(data)


def read_session_cookie(settings: Settings, raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return _serializer(settings).loads(raw)
    except BadSignature:
        return None


def principal_from_session(settings: Settings, session: dict | None) -> Principal | None:
    if not session:
        return None
    role = session.get("role")
    if role not in {"bureau", "chauffeur"}:
        return None
    return Principal(
        subject=session["sub"],
        label=session.get("label", session["sub"]),
        role=role,
        email=session.get("email"),
        chauffeur_id=session.get("chauffeur_id"),
        via_ia=False,
        scope="write",
    )


# --- Jetons d'API ----------------------------------------------------------
def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_token() -> str:
    return "bk_" + secrets.token_urlsafe(32)


def create_api_token(conn: sqlite3.Connection, nom: str, scope: str = "read", is_ia: bool = True) -> str:
    """Crée un jeton, stocke uniquement son hachage, renvoie le jeton clair (une fois)."""
    if scope not in {"read", "write"}:
        raise ValueError("scope invalide")
    token = generate_token()
    conn.execute(
        "INSERT INTO api_tokens (nom, token_hash, scope, is_ia) VALUES (?, ?, ?, ?)",
        (nom, hash_token(token), scope, 1 if is_ia else 0),
    )
    conn.commit()
    return token


def principal_from_token(conn: sqlite3.Connection, raw_token: str | None) -> Principal | None:
    if not raw_token:
        return None
    row = conn.execute(
        "SELECT * FROM api_tokens WHERE token_hash = ? AND revoked = 0",
        (hash_token(raw_token),),
    ).fetchone()
    if row is None:
        return None
    conn.execute(
        "UPDATE api_tokens SET last_used = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        (row["id"],),
    )
    conn.commit()
    # Un jeton a une portée technique ; rôle bureau en lecture pour les intégrations.
    return Principal(
        subject=f"token:{row['id']}",
        label=f"API:{row['nom']}",
        role="bureau",
        via_ia=bool(row["is_ia"]),
        scope=row["scope"],
    )


def dev_principal(settings: Settings, role: str, chauffeur_id: int | None = None) -> Principal:
    """Principal factice pour DEV_LOGIN (refusé si APP_ENV=production)."""
    if not settings.dev_login_enabled:
        raise PermissionError("DEV_LOGIN désactivé")
    role = role if role in {"bureau", "chauffeur"} else "bureau"
    return Principal(
        subject=f"dev:{role}",
        label=f"Dev {role}",
        role=role,
        email=f"{role}@dev.local",
        chauffeur_id=chauffeur_id,
    )


def resolve_role_from_userinfo(settings: Settings, userinfo: dict) -> str | None:
    groups = userinfo.get(settings.oidc_groups_claim) or []
    if isinstance(groups, str):
        groups = [groups]
    return role_from_groups(
        groups,
        group_bureau=settings.oidc_group_bureau,
        group_chauffeur=settings.oidc_group_chauffeur,
    )
