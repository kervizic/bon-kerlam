"""beta.21 — correction du bug « Clôturée » + purge corbeille.

Vérifie, sans base, que :
- close_overdue n'affecte JAMAIS un brouillon (clause numero IS NOT NULL) ;
- purge_corbeille délègue à la fonction SQL bon.purge_corbeille ;
- l'ordonnanceur nocturne appelle la PURGE, plus l'auto-clôture.
"""

from __future__ import annotations

import inspect

from app import closing, main


def test_close_overdue_exclut_brouillons(monkeypatch):
    captured = {}

    def fake_query(sql, params=None):
        captured["sql"] = sql
        return [{"id": 1}]

    monkeypatch.setattr(closing.db, "query", fake_query)
    assert closing.close_overdue() == [1]
    # Garde-fou déterministe : un brouillon (numero NULL) n'est jamais clôturé.
    assert "numero IS NOT NULL" in captured["sql"]
    assert "'cloturee'" in captured["sql"]


def test_purge_corbeille_delegue_a_la_fonction_sql(monkeypatch):
    captured = {}

    def fake_query(sql, params=None):
        captured["sql"] = sql
        return [{"r": {"purged": 2, "ids": [10, 11]}}]

    monkeypatch.setattr(closing.db, "query", fake_query)
    out = closing.purge_corbeille()
    assert out == {"purged": 2, "ids": [10, 11]}
    assert "bon.purge_corbeille()" in captured["sql"]


def test_purge_corbeille_vide(monkeypatch):
    monkeypatch.setattr(closing.db, "query", lambda sql, params=None: [])
    assert closing.purge_corbeille() == {"purged": 0, "ids": []}


def test_maintenance_loop_ne_cloture_plus():
    # La boucle nocturne doit invoquer la purge, et NON l'auto-clôture.
    src = inspect.getsource(main._maintenance_loop)
    assert "purge_corbeille" in src
    assert "close_overdue" not in src
