"""Signature électronique (sans réseau ni base) : client Documenso mocké +
validation du groupage par mail."""

import pytest
from app import documenso, signature
from app.config import settings


class FakeResp:
    def __init__(self, status=200, data=None, text=""):
        self.status_code = status
        self._data = data or {}
        self.text = text

    def json(self):
        return self._data


def test_headers_exige_cle(monkeypatch):
    monkeypatch.setattr(settings, "documenso_api_key", "")
    with pytest.raises(documenso.DocumensoError):
        documenso._headers()


def test_create_document_flux(monkeypatch):
    monkeypatch.setattr(settings, "documenso_api_key", "api_test")
    monkeypatch.setattr(settings, "documenso_url", "https://sign.kerlam.fr")
    calls = {"post": [], "put": 0}

    def fake_post(url, **kw):
        calls["post"].append(url)
        if url.endswith("/documents"):
            return FakeResp(200, {
                "documentId": 77, "uploadUrl": "https://s3/up",
                "recipients": [{"recipientId": 5, "token": "tok123"}],
            })
        return FakeResp(200, {"message": "ok"})

    def fake_put(url, **kw):
        calls["put"] += 1
        return FakeResp(200)

    monkeypatch.setattr(documenso.httpx, "post", fake_post)
    monkeypatch.setattr(documenso.httpx, "put", fake_put)

    res = documenso.create_document(
        "Titre", "Jean", "jean@example.test", b"%PDF-1.4", send_email=False,
    )
    assert res["document_id"] == 77
    assert res["signing_url"] == "https://sign.kerlam.fr/sign/tok123"
    assert calls["put"] == 1
    # create + fields + send
    assert any(u.endswith("/documents") for u in calls["post"])
    assert any(u.endswith("/fields") for u in calls["post"])
    assert any(u.endswith("/send") for u in calls["post"])


def test_par_mail_refuse_contacts_differents(monkeypatch):
    monkeypatch.setattr(
        signature, "_rows",
        lambda ids: [
            {"id": 1, "numero": "KER-1", "contact_id": 10, "statut": "a_signer"},
            {"id": 2, "numero": "KER-2", "contact_id": 20, "statut": "a_signer"},
        ],
    )
    with pytest.raises(ValueError, match="même contact"):
        signature.par_mail([1, 2])


def test_par_mail_refuse_contact_absent(monkeypatch):
    monkeypatch.setattr(
        signature, "_rows",
        lambda ids: [{"id": 1, "numero": "KER-1", "contact_id": None, "statut": "a_signer"}],
    )
    with pytest.raises(ValueError):
        signature.par_mail([1])


def test_sur_place_exige_contact_email(monkeypatch):
    monkeypatch.setattr(signature, "_signer", lambda lv_id: {"numero": "KER-1", "contact_email": None})
    with pytest.raises(ValueError, match="contact signataire"):
        signature.sur_place([1])
