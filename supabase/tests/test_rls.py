"""RLS : chauffeur = ses LV ; bureau = tout ; non autorisé = rien. Création
limitée (chauffeur : article + chantier ; pas de client)."""

import psycopg
import pytest
from conftest import as_postgres, as_user


def _setup_two_lv(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'R1'),(%s,'R2') RETURNING id",
            (actors["client_id"], actors["client_id"]),
        )
        p = [r[0] for r in cur.fetchall()]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email) VALUES (%s,%s),(%s,%s)",
            (p[0], actors["chauffeur"], p[1], actors["chauffeur2"]),
        )


def test_chauffeur_voit_ses_lv(conn, actors):
    _setup_two_lv(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.lettres_voiture")
        assert cur.fetchone()[0] == 1


def test_bureau_voit_tout(conn, actors):
    _setup_two_lv(conn, actors)
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.lettres_voiture")
        assert cur.fetchone()[0] == 2


def test_non_autorise_ne_voit_rien(conn, actors):
    _setup_two_lv(conn, actors)
    as_user(conn, actors["outsider"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.lettres_voiture")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM api.profil")
        assert cur.fetchone()[0] == 0


def test_desactive_ne_voit_rien(conn, actors):
    _setup_two_lv(conn, actors)
    as_user(conn, actors["desactive"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.lettres_voiture")
        assert cur.fetchone()[0] == 0


def test_chauffeur_cree_article_et_chantier_mais_pas_client(conn, actors):
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        # Article : autorisé.
        cur.execute("INSERT INTO bon.articles (nom) VALUES ('Nouvel article')")
        # Chantier : autorisé.
        cur.execute(
            "INSERT INTO bon.sites (nom, portee, client_id) VALUES ('Ch','chantier',%s)",
            (actors["client_id"],),
        )
    # Client : interdit.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("INSERT INTO bon.clients (raison_sociale) VALUES ('X')")
    # Site commun par un chauffeur : interdit.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("INSERT INTO bon.sites (nom, portee) VALUES ('C','commun')")
