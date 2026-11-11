"""Tests d'intégration HTTP : santé, version, injection de version dans le shell,
DEV_LOGIN, droits, parcours de création d'une LV."""

from __future__ import annotations

import importlib
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


def make_client(tmp_path: Path) -> TestClient:
    os.environ["APP_ENV"] = "dev"
    os.environ["DEV_LOGIN"] = "1"
    os.environ["DATA_DIR"] = str(tmp_path / "data")
    os.environ["SEED_DEV"] = "1"
    os.environ["SESSION_SECRET"] = "test-secret"
    os.environ.pop("APP_VERSION", None)

    from app.config import get_settings

    get_settings.cache_clear()
    from app import main as main_module

    importlib.reload(main_module)
    return TestClient(main_module.app)


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    with make_client(tmp_path) as c:
        yield c


def test_health(client: TestClient):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_version(client: TestClient):
    r = client.get("/api/version")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "0.1.0-beta.1"
    assert "schema_version" in body
    assert r.headers.get("x-app-version") == "0.1.0-beta.1"


def test_index_injects_version_and_versioned_assets(client: TestClient):
    r = client.get("/")
    assert r.status_code == 200
    html = r.text
    assert 'name="app-version"' in html
    assert 'content="0.1.0-beta.1"' in html
    assert "?v=0.1.0-beta.1" in html
    # Le jeton ne doit plus apparaître après substitution.
    assert "__APP_VERSION__" not in html


def test_requires_auth(client: TestClient):
    assert client.get("/api/v1/lettres").status_code == 401


def test_dev_login_and_lv_flow(client: TestClient):
    # Connexion bureau.
    assert client.post("/api/auth/dev-login", params={"role": "bureau"}).status_code == 200
    me = client.get("/api/auth/me").json()
    assert me["authenticated"] and me["role"] == "bureau"

    # Référentiels seedés disponibles.
    clients = client.get("/api/v1/clients").json()
    projets = client.get("/api/v1/projets").json()
    assert clients and projets
    client_id = clients[0]["id"]
    projet_id = projets[0]["id"]

    # Création d'une LV (sans numéro tant qu'aucun tour).
    r = client.post("/api/v1/lettres", json={
        "projet_id": projet_id, "client_id": client_id, "jour": "2026-11-11",
    })
    assert r.status_code == 201
    lv = r.json()
    assert lv["numero"] is None
    assert lv["dest_identique_exp"] == 1

    # Premier tour -> numéro KER-03000.
    r = client.post(f"/api/v1/lettres/{lv['id']}/tours", json={"heure_depart": "07:00"})
    assert r.status_code == 201
    assert r.json()["numero"] == "KER-03000"


def test_chauffeur_cannot_create_token(client: TestClient):
    client.post("/api/auth/dev-login", params={"role": "chauffeur"})
    r = client.post("/api/v1/tokens", json={"nom": "ia", "scope": "read"})
    assert r.status_code == 403
