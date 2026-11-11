"""Vérification des jetons IA (hachés en base) et des sessions utilisateur (JWT)."""

from __future__ import annotations

from fastapi import Header, HTTPException

from . import db
from .config import settings


def _scope(token: str) -> str | None:
    row = db.query_one("SELECT svc.ai_token_scope(%s) AS scope", (token,))
    return row["scope"] if row else None


def require_token(min_scope: str = "read"):
    """Dépendance FastAPI : exige un jeton IA valide de portée suffisante.

    'read' accepte read et write ; 'write' exige write.
    """

    async def _dep(x_ai_token: str | None = Header(default=None)) -> dict:
        if not x_ai_token:
            raise HTTPException(status_code=401, detail="Jeton IA requis (X-AI-Token).")
        scope = _scope(x_ai_token)
        if scope is None:
            raise HTTPException(status_code=403, detail="Jeton invalide ou révoqué.")
        if min_scope == "write" and scope != "write":
            raise HTTPException(status_code=403, detail="Jeton en lecture seule.")
        return {"scope": scope, "via_ia": True}

    return _dep


def decode_session(token: str) -> dict:
    """Décode un jeton de session Supabase (GoTrue, HS256, signé par JWT_SECRET).

    Renvoie les claims utiles (email, sub). Lève ValueError si le jeton est
    invalide, expiré ou si JWT_SECRET n'est pas configuré.
    """
    if not settings.jwt_secret:
        raise ValueError("JWT_SECRET non configuré.")
    import jwt  # import paresseux (PyJWT)

    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience=settings.jwt_aud,
        )
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Session invalide: {exc}") from exc
    email = claims.get("email") or (claims.get("user_metadata") or {}).get("email")
    return {"email": email, "sub": claims.get("sub"), "claims": claims}


async def require_user(authorization: str | None = Header(default=None)) -> dict:
    """Dépendance FastAPI : exige un jeton de session Supabase valide (Bearer)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Jeton de session requis.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        return decode_session(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
