"""Undo : limité aux actions de son auteur, bloqué après signature."""

import psycopg
import pytest
from conftest import as_postgres, as_user


def _lv_with_tour(conn, actors, expediteur="A"):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PU') RETURNING id",
            (actors["client_id"],),
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email) VALUES (%s,%s) RETURNING id",
            (projet, actors["chauffeur"]),
        )
        lv = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.tours (lv_id, expediteur) VALUES (%s,%s) RETURNING id",
            (lv, expediteur),
        )
        tour = cur.fetchone()[0]
    return lv, tour


def _expediteur(cur, tour):
    cur.execute("SELECT expediteur FROM bon.tours WHERE id=%s", (tour,))
    return cur.fetchone()[0]


def test_undo_reverts_own_action(conn, actors):
    lv, tour = _lv_with_tour(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("UPDATE bon.tours SET expediteur='B' WHERE id=%s", (tour,))
        assert _expediteur(cur, tour) == "B"
        cur.execute("SELECT bon.lv_undo(%s)", (lv,))
        assert cur.fetchone()[0]["undone"] is True
        assert _expediteur(cur, tour) == "A"


def test_undo_only_own_actions(conn, actors):
    lv, tour = _lv_with_tour(conn, actors)
    # Le bureau modifie.
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("UPDATE bon.tours SET expediteur='C' WHERE id=%s", (tour,))
    # Le chauffeur ne peut pas annuler l'action du bureau.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT bon.lv_undo(%s)", (lv,))
        assert cur.fetchone()[0]["undone"] is False
        assert _expediteur(cur, tour) == "C"
    # Le bureau annule sa propre action.
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT bon.lv_undo(%s)", (lv,))
        assert cur.fetchone()[0]["undone"] is True
        assert _expediteur(cur, tour) == "A"


def test_undo_bloque_apres_signature(conn, actors):
    lv, tour = _lv_with_tour(conn, actors)
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("UPDATE bon.lettres_voiture SET statut='signee' WHERE id=%s", (lv,))
    as_user(conn, actors["chauffeur"])
    with pytest.raises(psycopg.errors.RaiseException):
        with conn.cursor() as cur:
            cur.execute("SELECT bon.lv_undo(%s)", (lv,))


def test_destinataire_identique_coche_doffice(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PX') RETURNING id",
            (actors["client_id"],),
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email) VALUES (%s,%s) "
            "RETURNING dest_identique",
            (projet, actors["chauffeur"]),
        )
        assert cur.fetchone()[0] is True
