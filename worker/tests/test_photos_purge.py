"""beta.35 — purge des objets storage des photos de lignes (sans base ni réseau)."""

from __future__ import annotations

from app import photos


class _Resp:
    def __init__(self, code):
        self.status_code = code
        self.text = ""


def _fake_db(monkeypatch, rows):
    calls = []

    def fake_query(sql, params=None):
        calls.append((sql, params))
        if "FROM bon.storage_purge WHERE attempts" in sql:
            return rows
        return []

    monkeypatch.setattr(photos.db, "query", fake_query)
    monkeypatch.setattr(photos.db, "query_one", lambda sql, params=None: {"n": 1})
    return calls


def test_purge_ok_vide_la_file(monkeypatch):
    rows = [
        {"id": 1, "bucket": "photos-lignes", "path": "lv/1/ligne/2/a.jpg"},
        {"id": 2, "bucket": "photos-lignes", "path": "lv/1/ligne/2/a.thumb.jpg"},
    ]
    calls = _fake_db(monkeypatch, rows)
    monkeypatch.setattr(photos.settings, "service_role_key", "k")
    sent = {}

    def fake_request(method, url, headers=None, json=None, timeout=None):
        sent.update(method=method, url=url, json=json)
        return _Resp(200)

    monkeypatch.setattr(photos.httpx, "request", fake_request)
    out = photos.process_storage_purge()
    assert out == {"photos_tours_corbeille": 1, "objets_supprimes": 2, "erreurs": 0}
    assert sent["method"] == "DELETE"
    assert sent["url"].endswith("/object/photos-lignes")
    assert "/storage/v1" not in sent["url"]
    assert sent["json"] == {"prefixes": ["lv/1/ligne/2/a.jpg", "lv/1/ligne/2/a.thumb.jpg"]}
    assert any(sql.startswith("DELETE FROM bon.storage_purge") and p == ([1, 2],) for sql, p in calls)


def test_purge_echec_reste_en_file(monkeypatch):
    rows = [{"id": 7, "bucket": "photos-lignes", "path": "lv/1/ligne/2/b.jpg"}]
    calls = _fake_db(monkeypatch, rows)
    monkeypatch.setattr(photos.settings, "service_role_key", "k")
    monkeypatch.setattr(photos.httpx, "request", lambda *a, **k: _Resp(500))
    out = photos.process_storage_purge()
    assert out["erreurs"] == 1 and out["objets_supprimes"] == 0
    assert any("attempts = attempts + 1" in sql for sql, _ in calls)
    assert not any(sql.startswith("DELETE FROM bon.storage_purge") for sql, _ in calls)


def test_sans_cle_service_aucun_appel(monkeypatch):
    _fake_db(monkeypatch, [{"id": 1, "bucket": "photos-lignes", "path": "x"}])
    monkeypatch.setattr(photos.settings, "service_role_key", "")

    def boom(*a, **k):
        raise AssertionError("aucun appel storage attendu")

    monkeypatch.setattr(photos.httpx, "request", boom)
    out = photos.process_storage_purge()
    assert out["objets_supprimes"] == 0
