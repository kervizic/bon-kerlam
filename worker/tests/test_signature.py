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


def _blank_pdf(n_pages: int) -> bytes:
    """PDF A4 vide de n_pages (pour tester la pagination du PDF combiné)."""
    import io

    from pypdf import PdfWriter

    w = PdfWriter()
    for _ in range(n_pages):
        w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_signature_fields_positions_et_pages():
    # Deux lettres : dernières pages 2 et 5 dans le PDF combiné.
    fields = signature.signature_fields([2, 5])
    assert len(fields) == 4  # SIGNATURE + NAME par lettre
    sig2, nom2, sig5, nom5 = fields
    assert [f["type"] for f in fields] == ["SIGNATURE", "NAME", "SIGNATURE", "NAME"]
    assert [sig2["pageNumber"], nom2["pageNumber"]] == [2, 2]
    assert [sig5["pageNumber"], nom5["pageNumber"]] == [5, 5]
    # Ancres en % de page A4 (210 x 297 mm), coin haut-gauche.
    assert sig2["pageX"] == round(17 / 210 * 100, 4) == 8.0952
    assert sig2["pageY"] == round(245 / 297 * 100, 4) == 82.4916
    assert sig2["pageWidth"] == round(66 / 210 * 100, 4) == 31.4286
    assert sig2["pageHeight"] == round(15 / 297 * 100, 4) == 5.0505
    assert nom2["pageY"] == round(262 / 297 * 100, 4) == 88.2155
    assert nom2["pageHeight"] == round(5 / 297 * 100, 4) == 1.6835


def test_build_combined_pdf_dernieres_pages(monkeypatch):
    # Lettres de 1, 2 et 1 pages -> dernières pages 1, 3, 4 dans le combiné.
    pages_par_lv = {7: 1, 8: 2, 9: 1}
    monkeypatch.setattr(signature, "_build_pdf", lambda lv_id: _blank_pdf(pages_par_lv[lv_id]))
    merged, last_pages = signature.build_combined_pdf([7, 8, 9])
    assert last_pages == [1, 3, 4]
    import io

    from pypdf import PdfReader
    assert len(PdfReader(io.BytesIO(merged)).pages) == 4


def test_create_document_pose_signature_et_nom(monkeypatch):
    # Les champs fournis (SIGNATURE + NAME) sont tous postés avec recipientId.
    monkeypatch.setattr(settings, "documenso_api_key", "api_test")
    monkeypatch.setattr(settings, "documenso_url", "https://sign.kerlam.fr")
    posted_fields = []

    def fake_post(url, **kw):
        if url.endswith("/documents"):
            return FakeResp(200, {
                "documentId": 9, "uploadUrl": "https://s3/up",
                "recipients": [{"recipientId": 3, "token": "tok"}],
            })
        if url.endswith("/fields"):
            posted_fields.append(kw.get("json"))
        return FakeResp(200, {"message": "ok"})

    monkeypatch.setattr(documenso.httpx, "post", fake_post)
    monkeypatch.setattr(documenso.httpx, "put", lambda url, **kw: FakeResp(200))

    documenso.create_document(
        "T", "Jean", "j@example.test", b"%PDF-1.4", send_email=False,
        fields=signature.signature_fields([2]),
    )
    assert [f["type"] for f in posted_fields] == ["SIGNATURE", "NAME"]
    assert all(f["recipientId"] == 3 for f in posted_fields)
    assert all(f["pageNumber"] == 2 for f in posted_fields)
