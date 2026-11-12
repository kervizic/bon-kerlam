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


def test_chauffeur_cree_referentiels_mais_pas_site_commun(conn, actors):
    # beta.17 : le chauffeur peut créer client / projet / contact / chantier
    # (fiche rapide). Le site commun reste réservé au bureau.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.articles (nom) VALUES ('Nouvel article')")
        cur.execute(
            "INSERT INTO bon.sites (nom, portee, client_id) VALUES ('Ch','chantier',%s)",
            (actors["client_id"],),
        )
        # Client / projet / contact : désormais autorisés au chauffeur.
        cur.execute("INSERT INTO bon.clients (raison_sociale) VALUES ('Franciliane') RETURNING id")
        cid = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.projets (client_id, nom) VALUES (%s,'Chantier A')", (cid,))
        cur.execute(
            "INSERT INTO bon.contacts (client_id, nom, email) VALUES (%s,'Paul','p@x.fr')",
            (cid,),
        )
    # Site commun par un chauffeur : interdit.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("INSERT INTO bon.sites (nom, portee) VALUES ('C','commun')")


def test_chauffeur_ne_modifie_pas_la_fiche_d_un_autre(conn, actors):
    # Le client du fixture (créé en superuser, created_by NULL) n'est modifiable
    # que par le bureau : un chauffeur ne peut pas le renommer.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE bon.clients SET adresse = 'piratee' WHERE id = %s",
            (actors["client_id"],),
        )
        assert cur.rowcount == 0  # RLS masque la ligne : aucune modification
    # Le bureau, lui, modifie tout.
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE bon.clients SET adresse = 'ok' WHERE id = %s", (actors["client_id"],)
        )
        assert cur.rowcount == 1


def test_chauffeur_modifie_son_propre_client(conn, actors):
    # Un chauffeur peut modifier la fiche client qu'il a lui-même créée.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.clients (raison_sociale) VALUES ('MonClient') RETURNING id")
        cid = cur.fetchone()[0]
        cur.execute("UPDATE bon.clients SET adresse = '1 rue X' WHERE id = %s", (cid,))
        assert cur.rowcount == 1
    # Un autre chauffeur ne peut pas la modifier.
    as_user(conn, actors["chauffeur2"])
    with conn.cursor() as cur:
        cur.execute("UPDATE bon.clients SET adresse = 'non' WHERE id = %s", (cid,))
        assert cur.rowcount == 0
