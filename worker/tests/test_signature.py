"""Signature électronique (sans réseau ni base) : client Documenso mocké +
validation du groupage par mail."""

import pytest
from app import documenso, pdf, signature
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


class FakeClient:
    """Client httpx factice (keep-alive) : enregistre les appels de create_document."""
    def __init__(self, calls, **kw):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, **kw):
        self.calls["post"].append(url)
        if url.endswith("/documents"):
            return FakeResp(200, {
                "documentId": 77, "uploadUrl": "https://s3/up",
                "recipients": [{"recipientId": 5, "token": "tok123"}],
            })
        if url.endswith("/fields"):
            self.calls.setdefault("fields", []).append(kw.get("json"))
        return FakeResp(200, {"message": "ok"})

    def put(self, url, **kw):
        self.calls["put"] += 1
        return FakeResp(200)


def test_create_document_flux(monkeypatch):
    monkeypatch.setattr(settings, "documenso_api_key", "api_test")
    monkeypatch.setattr(settings, "documenso_url", "https://sign.kerlam.fr")
    calls = {"post": [], "put": 0}
    monkeypatch.setattr(documenso.httpx, "Client", lambda **kw: FakeClient(calls, **kw))

    res = documenso.create_document(
        "Titre", "Jean", "jean@example.test", b"%PDF-1.4", send_email=False,
    )
    assert res["document_id"] == 77
    assert res["signing_url"] == "https://sign.kerlam.fr/sign/tok123"
    assert calls["put"] == 1
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


def test_refuse_renvoi_lettre_signee(monkeypatch):
    # beta.29 : une lettre déjà signée ne peut pas être renvoyée en signature (409).
    monkeypatch.setattr(signature, "_rows", lambda ids: [
        {"id": 7, "numero": "KER-03003", "contact_id": 2, "statut": "signee", "documenso_document_id": 57},
    ])
    with pytest.raises(signature.SignatureConflict, match="signée"):
        signature.sur_place([7])


def test_refuse_renvoi_signature_active(monkeypatch):
    # Lettre en signature active (a_signer + document attaché) : refusée (409).
    monkeypatch.setattr(signature, "_rows", lambda ids: [
        {"id": 7, "numero": "KER-03003", "contact_id": 2, "statut": "a_signer", "documenso_document_id": 60},
    ])
    with pytest.raises(signature.SignatureConflict, match="en cours"):
        signature.par_mail([7])


def test_autorise_lettre_en_cours(monkeypatch):
    # Une lettre en_cours sans document attaché reste signable (pas de conflit).
    rows = [{"id": 7, "numero": "KER-03003", "contact_id": 2, "statut": "en_cours", "documenso_document_id": None}]
    signature._assert_signable(rows)  # ne lève pas


def test_sur_place_exige_contact_email(monkeypatch):
    monkeypatch.setattr(signature, "_rows",
                        lambda ids: [{"id": 1, "numero": "KER-1", "contact_id": 10, "statut": "en_cours"}])
    monkeypatch.setattr(signature, "_signer", lambda lv_id: {"numero": "KER-1", "contact_email": None})
    with pytest.raises(ValueError, match="contact signataire|e-mail"):
        signature.sur_place([1])


def test_sur_place_un_seul_document_pour_le_lot(monkeypatch):
    # beta.24 : UN SEUL document Documenso pour tout le lot (même signataire).
    monkeypatch.setattr(signature, "_rows", lambda ids: [
        {"id": 7, "numero": "KER-03003", "contact_id": 10, "statut": "en_cours"},
        {"id": 8, "numero": "KER-03004", "contact_id": 10, "statut": "en_cours"},
    ])
    monkeypatch.setattr(signature, "_signer",
                        lambda lv_id: {"contact_nom": "Manu", "contact_email": "manu@kervizic.fr"})
    monkeypatch.setattr(signature, "build_combined_pdf", lambda ids: (b"%PDF", [1, 2], [{"type": "SIGNATURE"}]))
    created = {}

    def fake_create(**kw):
        created.update(kw)
        return {"document_id": 99, "token": "tok99", "signing_url": "u"}

    monkeypatch.setattr(signature.documenso, "create_document", fake_create)
    updates = []
    monkeypatch.setattr(signature.db, "query", lambda sql, params=None: updates.append((sql, params)) or [])
    res = signature.sur_place([7, 8])
    # Un seul appel create_document, pas d'e-mail, token renvoyé.
    assert created["send_email"] is False
    assert res["document_id"] == 99 and res["token"] == "tok99"
    assert res["lv_ids"] == [7, 8] and res["signer_name"] == "Manu"
    # Un seul UPDATE qui marque TOUTES les lettres du lot avec le même documenso_id.
    assert len(updates) == 1
    assert updates[0][1] == (99, [7, 8])


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


def test_anchor_field_conversion_pct():
    # Boîte d'ancre WeasyPrint (px, origine haut-gauche) -> champ Documenso (%).
    # Page A4 en px à 96 dpi : 793.70 x 1122.52.
    pw, ph = 793.7007874015749, 1122.5196850393702
    sig = pdf.anchor_field("SIGNATURE", 3, (72.252, 411.772, 321.701, 468.465), pw, ph)
    assert sig["type"] == "SIGNATURE" and sig["pageNumber"] == 3
    assert sig["pageX"] == round(72.252 / pw * 100, 4)
    assert sig["pageY"] == round(411.772 / ph * 100, 4)
    assert sig["pageWidth"] == round((321.701 - 72.252) / pw * 100, 4)
    assert sig["pageHeight"] == round((468.465 - 411.772) / ph * 100, 4)
    # ~66 x 15 mm (31,4 % x 5,05 %) en bas de page (~37 %).
    assert 31.0 < sig["pageWidth"] < 31.9
    assert 4.8 < sig["pageHeight"] < 5.3


def test_build_combined_pdf_depuis_cache(monkeypatch):
    # beta.25 : build_combined_pdf fusionne les PDF EN CACHE par lettre (pas de
    # rendu). Lettres de 1, 2 et 1 pages -> dernières pages 1, 3, 4 ; beta.29 : UN
    # SEUL champ SIGNATURE par lettre, sur la dernière page (page-locale), le nom
    # étant imprimé en dur dans le PDF.
    pages_par_lv = {7: 1, 8: 2, 9: 1}

    def fake_cached(lv_id, *a, **k):
        n = pages_par_lv[lv_id]
        local = [
            {"type": "SIGNATURE", "pageNumber": n, "pageX": 9, "pageY": 43, "pageWidth": 31, "pageHeight": 5},
        ]
        return _blank_pdf(n), local, n

    monkeypatch.setattr(signature.pdf, "letter_cached", fake_cached)
    merged, last_pages, fields = signature.build_combined_pdf([7, 8, 9])
    assert last_pages == [1, 3, 4]
    import io

    from pypdf import PdfReader
    assert len(PdfReader(io.BytesIO(merged)).pages) == 4
    # Un SIGNATURE par lettre, décalé en pages absolues : 7 -> p1, 8 -> p3, 9 -> p4.
    assert [f["type"] for f in fields] == ["SIGNATURE", "SIGNATURE", "SIGNATURE"]
    assert [f["pageNumber"] for f in fields] == [1, 3, 4]


def _capture_client(calls):
    """FakeClient qui mémorise le corps JSON du POST /documents (meta inclus)."""
    class _C(FakeClient):
        def post(self, url, **kw):
            self.calls["post"].append(url)
            if url.endswith("/documents") and not url.endswith("/fields"):
                self.calls["body"] = kw.get("json")
                return FakeResp(200, {"documentId": 1, "uploadUrl": "https://s3/up",
                                      "recipients": [{"recipientId": 2, "token": "t"}]})
            if url.endswith("/fields"):
                self.calls.setdefault("fields", []).append(kw.get("json"))
            return FakeResp(200, {"message": "ok"})
    return lambda **kw: _C(calls, **kw)


def test_presentiel_coupe_tous_les_mails(monkeypatch):
    # beta.25 : présentiel -> distributionMethod NONE + TOUS les e-mails coupés.
    monkeypatch.setattr(settings, "documenso_api_key", "api_test")
    calls = {"post": [], "put": 0}
    monkeypatch.setattr(documenso.httpx, "Client", _capture_client(calls))
    documenso.create_document("T", "J", "j@example.test", b"%PDF-1.4", send_email=False)
    meta = calls["body"]["meta"]
    assert meta["distributionMethod"] == "NONE"
    assert all(v is False for v in meta["emailSettings"].values())


def test_par_mail_active_seulement_invitation(monkeypatch):
    # Par mail -> EMAIL, et SEULE l'invitation à signer (recipientSigningRequest) est active.
    monkeypatch.setattr(settings, "documenso_api_key", "api_test")
    calls = {"post": [], "put": 0}
    monkeypatch.setattr(documenso.httpx, "Client", _capture_client(calls))
    documenso.create_document("T", "J", "j@example.test", b"%PDF-1.4", send_email=True)
    es = calls["body"]["meta"]["emailSettings"]
    assert calls["body"]["meta"]["distributionMethod"] == "EMAIL"
    assert es["recipientSigningRequest"] is True
    assert all(v is False for k, v in es.items() if k != "recipientSigningRequest")


def test_warm_cache_local_sans_documenso(monkeypatch):
    # Préchauffe LOCALE : letter_cached par lettre, aucun appel Documenso.
    vus = []
    monkeypatch.setattr(signature.pdf, "letter_cached", lambda lv_id, *a, **k: vus.append(lv_id) or (b"%PDF", [], 1))
    monkeypatch.setattr(signature.documenso, "create_document",
                        lambda *a, **k: pytest.fail("warm_cache ne doit créer AUCUN document"))
    assert signature.warm_cache([7, 8, 9]) == {"warmed": 3}
    assert vus == [7, 8, 9]


def test_send_signed_mail_objet_et_copie(monkeypatch):
    # Après signature : UN mail au contact, objet = plage des numéros, PDF joint.
    monkeypatch.setattr(signature.db, "query", lambda sql, params=None: [
        {"numero": "KER-03003", "contact_email": "manu@kervizic.fr"},
        {"numero": "KER-03007", "contact_email": "manu@kervizic.fr"},
    ])
    sent = {}
    from app import mailer
    monkeypatch.setattr(mailer, "send_mail",
                        lambda to, subject, body, attachment=None: sent.update(
                            to=to, subject=subject, body=body, attachment=attachment) or True)
    signature._send_signed_mail(99, b"%PDF-signed")
    assert sent["to"] == "manu@kervizic.fr"
    assert sent["subject"] == "Lettres de voiture signées : KER-03003 à KER-03007"
    assert sent["attachment"][1] == b"%PDF-signed"
    assert sent["attachment"][2] == "application/pdf"


def test_create_document_pose_champs_en_un_appel(monkeypatch):
    # beta.29 : TOUS les champs sont postés en UN SEUL appel /fields (tableau),
    # chacun avec recipientId. Ici 2 champs (sur une même page) -> 1 seul POST.
    monkeypatch.setattr(settings, "documenso_api_key", "api_test")
    monkeypatch.setattr(settings, "documenso_url", "https://sign.kerlam.fr")
    calls = {"post": [], "put": 0}

    class _C(FakeClient):
        def post(self, url, **kw):
            self.calls["post"].append(url)
            if url.endswith("/documents"):
                return FakeResp(200, {"documentId": 9, "uploadUrl": "https://s3/up",
                                      "recipients": [{"recipientId": 3, "token": "tok"}]})
            if url.endswith("/fields"):
                self.calls.setdefault("fields", []).append(kw.get("json"))
            return FakeResp(200, {"message": "ok"})

    monkeypatch.setattr(documenso.httpx, "Client", lambda **kw: _C(calls, **kw))
    fields = [
        pdf.anchor_field("SIGNATURE", 2, (72, 411, 321, 468), 793.7, 1122.5),
        pdf.anchor_field("SIGNATURE", 3, (72, 476, 321, 495), 793.7, 1122.5),
    ]
    documenso.create_document("T", "Jean", "j@example.test", b"%PDF-1.4", send_email=False, fields=fields)
    # Un seul appel /fields, dont le corps est un TABLEAU de champs.
    bodies = calls.get("fields", [])
    assert len(bodies) == 1, "les champs doivent être posés en un seul appel"
    posted = bodies[0]
    assert isinstance(posted, list) and len(posted) == 2
    assert all(f["type"] == "SIGNATURE" for f in posted)
    assert all(f["recipientId"] == 3 for f in posted)
    # L'ordre champs -> send est respecté : /fields avant /send.
    order = [u.rsplit("/", 1)[-1] for u in calls["post"]]
    assert order.index("fields") < order.index("send")
