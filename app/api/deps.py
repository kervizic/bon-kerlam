"""Dépendances FastAPI : connexion DB, principal courant, contrôle de rôle/portée."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator

from fastapi import Depends, Header, HTTPException, Request, status

from .. import auth
from ..config import Settings, get_settings


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    from ..db import connect

    settings: Settings = request.app.state.settings
    conn = connect(settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def current_principal(
    request: Request,
    conn: sqlite3.Connection = Depends(get_conn),
    authorization: str | None = Header(default=None),
) -> auth.Principal | None:
    settings: Settings = request.app.state.settings

    # 1) Jeton d'API (machine / IA).
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        principal = auth.principal_from_token(conn, token)
        if principal:
            return principal

    # 2) Session cookie (humain).
    raw = request.cookies.get(auth.SESSION_COOKIE)
    session = auth.read_session_cookie(settings, raw)
    return auth.principal_from_session(settings, session)


def require_principal(
    principal: auth.Principal | None = Depends(current_principal),
) -> auth.Principal:
    if principal is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    return principal


def require_write(
    principal: auth.Principal = Depends(require_principal),
) -> auth.Principal:
    if principal.scope != "write":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Portée écriture requise")
    return principal


def require_bureau(
    principal: auth.Principal = Depends(require_principal),
) -> auth.Principal:
    if principal.role != "bureau":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé au bureau")
    return principal


def settings_dep() -> Settings:
    return get_settings()
