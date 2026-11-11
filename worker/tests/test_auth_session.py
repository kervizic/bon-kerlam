"""Décodage du jeton de session Supabase (HS256) côté worker (sans base)."""

import time

import jwt
import pytest
from app import auth
from app.config import settings


def _token(secret, aud="authenticated", email="manu@kervizic.fr", exp_delta=3600):
    return jwt.encode(
        {"sub": "u-1", "email": email, "aud": aud, "exp": int(time.time()) + exp_delta},
        secret,
        algorithm="HS256",
    )


def test_decode_session_ok(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "s" * 32)
    claims = auth.decode_session(_token("s" * 32))
    assert claims["email"] == "manu@kervizic.fr"
    assert claims["sub"] == "u-1"


def test_decode_session_mauvais_secret(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "s" * 32)
    with pytest.raises(ValueError):
        auth.decode_session(_token("autre-secret-faux-faux-faux-123456"))


def test_decode_session_expire(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "s" * 32)
    with pytest.raises(ValueError):
        auth.decode_session(_token("s" * 32, exp_delta=-10))


def test_decode_session_sans_secret(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "")
    with pytest.raises(ValueError):
        auth.decode_session(_token("s" * 32))
