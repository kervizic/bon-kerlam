"""La route /worker/version renvoie la version attendue."""

from app.main import app
from fastapi.testclient import TestClient


def test_version_endpoint():
    with TestClient(app) as client:
        r = client.get("/worker/version")
        assert r.status_code == 200
        body = r.json()
        assert body["version"] == "0.1.0-beta.7"
        assert "sha" in body
        assert "schema_version" in body


def test_healthz():
    with TestClient(app) as client:
        assert client.get("/worker/healthz").json() == {"status": "ok"}


def test_read_requires_token():
    with TestClient(app) as client:
        # Sans jeton IA : 401.
        assert client.get("/worker/alertes").status_code == 401
