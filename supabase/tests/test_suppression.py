"""Suppression / annulation des lettres NON signées (0017) + mémoire des créneaux.

Règles : brouillon sans numéro -> corbeille (deleted_at, restaurable 30 j) ;
lettre numérotée non signée -> statut « annulée » + motif, numéro conservé ;
lettre signée -> jamais supprimable ; chauffeur limité à SES lettres.
"""

import psycopg
import pytest
from conftest import as_postgres, as_user


def _insert_lv(conn, actors, *, numero=None, statut="en_cours", owner=None):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email, numero, statut, chauffeur_id) "
            "VALUES (%s,%s,%s,%s,%s) RETURNING id",
            (actors["projet_id"], owner or actors["chauffeur"], numero, statut, actors["chauffeur_id"]),
        )
        return cur.fetchone()[0]


def test_brouillon_va_en_corbeille(conn, actors):
    lv_id = _insert_lv(conn, actors, numero=None)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.lv_supprimer(%s, NULL, NULL)", (lv_id,))
        res = cur.fetchone()[0]
        assert res["mode"] == "corbeille"
        # Mis à la corbeille : visible dans api.lv_corbeille, absent des listes.
        cur.execute("SELECT deleted_at, deleted_par FROM bon.lettres_voiture WHERE id = %s", (lv_id,))
        deleted_at, deleted_par = cur.fetchone()
        assert deleted_at is not None
        assert deleted_par == actors["chauffeur"]
        cur.execute("SELECT count(*) FROM api.lv_corbeille WHERE id = %s", (lv_id,))
        assert cur.fetchone()[0] == 1


def test_lettre_numerotee_est_annulee(conn, actors):
    lv_id = _insert_lv(conn, actors, numero="KER-90001")
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.lv_supprimer(%s, 'doublon', 'saisie en double')", (lv_id,))
        res = cur.fetchone()[0]
        assert res["mode"] == "annulee"
        cur.execute(
            "SELECT statut, numero, annulation_categorie, annulation_motif, annulee_par, deleted_at "
            "FROM bon.lettres_voiture WHERE id = %s",
            (lv_id,),
        )
        statut, numero, cat, motif, par, deleted_at = cur.fetchone()
        assert statut == "annulee"
        assert numero == "KER-90001"        # numéro conservé
        assert cat == "doublon"
        assert motif == "saisie en double"
        assert par == actors["chauffeur"]
        assert deleted_at is None           # annulée != corbeille


def test_lettre_signee_jamais_supprimable(conn, actors):
    lv_id = _insert_lv(conn, actors, numero="KER-90002", statut="signee")
    as_user(conn, actors["chauffeur"])
    with pytest.raises(psycopg.errors.RaiseException):
        with conn.cursor() as cur:
            cur.execute("SELECT api.lv_supprimer(%s, NULL, NULL)", (lv_id,))


def test_chauffeur_ne_supprime_pas_lettre_autrui(conn, actors):
    lv_id = _insert_lv(conn, actors, owner=actors["chauffeur2"])
    as_user(conn, actors["chauffeur"])
    with pytest.raises(psycopg.errors.RaiseException):
        with conn.cursor() as cur:
            cur.execute("SELECT api.lv_supprimer(%s, NULL, NULL)", (lv_id,))


def test_bureau_supprime_toute_lettre(conn, actors):
    lv_id = _insert_lv(conn, actors, owner=actors["chauffeur2"])
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.lv_supprimer(%s, NULL, NULL)", (lv_id,))
        assert cur.fetchone()[0]["mode"] == "corbeille"


def test_restauration_depuis_corbeille(conn, actors):
    lv_id = _insert_lv(conn, actors, numero=None)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.lv_supprimer(%s, NULL, NULL)", (lv_id,))
        cur.execute("SELECT api.lv_restaurer(%s)", (lv_id,))
        assert cur.fetchone()[0]["restored"] is True
        cur.execute("SELECT deleted_at FROM bon.lettres_voiture WHERE id = %s", (lv_id,))
        assert cur.fetchone()[0] is None


def test_dernieres_heures_reprend_les_creneaux(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email, chauffeur_id, heures) "
            "VALUES (%s,%s,%s, %s::jsonb)",
            (
                actors["projet_id"], actors["chauffeur"], actors["chauffeur_id"],
                '[{"debut":"08:00","fin":"12:00"},{"debut":"13:00","fin":"17:00"}]',
            ),
        )
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.dernieres_heures(%s)", (actors["chauffeur_id"],))
        heures = cur.fetchone()[0]
        assert isinstance(heures, list)
        assert heures[0]["debut"] == "08:00"
        assert heures[1]["fin"] == "17:00"
