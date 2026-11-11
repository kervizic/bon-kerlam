"""Vérification des jetons IA (hachés en base, portée lecture/écriture)."""

from __future__ import annotations

from fastapi import Header, HTTPException

from . import db


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
