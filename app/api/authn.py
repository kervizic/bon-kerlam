"""Endpoints d'authentification : DEV_LOGIN (dev) et OIDC Authorization Code + PKCE."""

from __future__ import annotations

import base64
import hashlib
import secrets
import sqlite3
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse

from .. import auth
from ..config import Settings
from .deps import current_principal, get_conn

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session(response: Response, settings: Settings, data: dict) -> None:
    cookie = auth.make_session_cookie(settings, data)
    response.set_cookie(
        auth.SESSION_COOKIE, cookie, httponly=True, secure=settings.cookie_secure,
        samesite="lax", max_age=60 * 60 * 12, path="/",
    )


@router.get("/me", summary="Principal courant")
def me(principal: auth.Principal | None = Depends(current_principal)) -> dict[str, Any]:
    if principal is None:
        return {"authenticated": False}
    return {
        "authenticated": True, "role": principal.role, "label": principal.label,
        "email": principal.email, "chauffeur_id": principal.chauffeur_id,
        "via_ia": principal.via_ia,
    }


@router.post("/logout", summary="Déconnexion")
def logout(request: Request) -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.SESSION_COOKIE, path="/")
    return resp


@router.post("/dev-login", summary="Connexion de développement (refusée en production)")
def dev_login(
    request: Request,
    role: str = Query("bureau"),
    chauffeur_id: int | None = Query(None),
) -> JSONResponse:
    settings: Settings = request.app.state.settings
    if not settings.dev_login_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "DEV_LOGIN désactivé (APP_ENV=production)")
    principal = auth.dev_principal(settings, role, chauffeur_id)
    resp = JSONResponse({"ok": True, "role": principal.role})
    _set_session(resp, settings, {
        "sub": principal.subject, "label": principal.label, "role": principal.role,
        "email": principal.email, "chauffeur_id": principal.chauffeur_id,
    })
    return resp


# --- OIDC Authorization Code + PKCE ----------------------------------------
_OIDC_CACHE: dict[str, dict] = {}


async def _discover(settings: Settings) -> dict:
    if "conf" in _OIDC_CACHE:
        return _OIDC_CACHE["conf"]
    url = settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10) as client:
        conf = (await client.get(url)).json()
    _OIDC_CACHE["conf"] = conf
    return conf


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


@router.get("/login", summary="Démarrer la connexion OIDC")
async def oidc_login(request: Request) -> RedirectResponse:
    settings: Settings = request.app.state.settings
    if not settings.oidc_issuer or not settings.oidc_client_id:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "OIDC non configuré")
    conf = await _discover(settings)
    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(16)
    params = {
        "response_type": "code", "client_id": settings.oidc_client_id,
        "redirect_uri": settings.oidc_redirect_uri, "scope": "openid email profile groups",
        "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256",
    }
    auth_url = httpx.URL(conf["authorization_endpoint"], params=params)
    resp = RedirectResponse(str(auth_url))
    # Stocke l'état PKCE dans un cookie signé court.
    resp.set_cookie(
        "bon_oidc", auth.make_session_cookie(settings, {"v": verifier, "s": state, "n": nonce}),
        httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=600, path="/",
    )
    return resp


@router.get("/callback", summary="Retour OIDC")
async def oidc_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> RedirectResponse:
    settings: Settings = request.app.state.settings
    saved = auth.read_session_cookie(settings, request.cookies.get("bon_oidc"))
    if not saved or saved.get("s") != state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "État OIDC invalide")
    conf = await _discover(settings)
    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.post(conf["token_endpoint"], data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": settings.oidc_redirect_uri, "client_id": settings.oidc_client_id,
            "client_secret": settings.oidc_client_secret, "code_verifier": saved["v"],
        })
        token_resp.raise_for_status()
        access = token_resp.json().get("access_token")
        userinfo = (await client.get(
            conf["userinfo_endpoint"], headers={"Authorization": f"Bearer {access}"}
        )).json()

    role = auth.resolve_role_from_userinfo(settings, userinfo)
    if role is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Aucun groupe bon-bureau / bon-chauffeur")

    sub = userinfo.get("sub")
    email = userinfo.get("email")
    label = userinfo.get("name") or email or sub
    chauffeur_id = None
    if role == "chauffeur":
        row = conn.execute(
            "SELECT id FROM chauffeurs WHERE oidc_sub = ? OR oidc_email = ?", (sub, email)
        ).fetchone()
        chauffeur_id = row["id"] if row else None

    resp = RedirectResponse("/", status_code=status.HTTP_302_FOUND)
    resp.delete_cookie("bon_oidc", path="/")
    _set_session(resp, settings, {
        "sub": sub, "label": label, "role": role, "email": email, "chauffeur_id": chauffeur_id,
    })
    return resp
