"""beta.18 : création des référentiels par un chauffeur via l'API (projet/contact),
destinataire distinct référencé client (nom + adresse sur PDF), et réconciliation
du catalogue d'articles (0019)."""

from conftest import as_postgres, as_user


def test_chauffeur_cree_projet_via_api(conn, actors):
    # RLS 0018 : un chauffeur (membre) insère un projet via la vue api.projets.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO api.projets (client_id, nom) VALUES (%s,'Chantier chauffeur') RETURNING id",
            (actors["client_id"],),
        )
        pid = cur.fetchone()[0]
        # Il peut ensuite le modifier (créateur = acteur courant).
        cur.execute("UPDATE api.projets SET nom='Chantier renomme' WHERE id=%s", (pid,))
        assert cur.rowcount == 1


def test_chauffeur_cree_contact_via_api(conn, actors):
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO api.contacts (client_id, nom, email) "
            "VALUES (%s,'Dupont','d@x.fr') RETURNING id",
            (actors["client_id"],),
        )
        assert cur.fetchone()[0] is not None


def test_destinataire_client_id_sur_lettre_et_api(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.clients (raison_sociale, adresse) "
            "VALUES ('Destinataire SAS','1 rue des Lilas, 77400 Lagny') RETURNING id"
        )
        dest_id = cur.fetchone()[0]
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.lettres_voiture (client_id, owner_email, dest_identique, destinataire_client_id) "
            "VALUES (%s,%s,false,%s) RETURNING id",
            (actors["client_id"], actors["chauffeur"], dest_id),
        )
        lv_id = cur.fetchone()[0]
        # Colonne exposée par la vue API (security_invoker, recréée en 0019).
        cur.execute("SELECT destinataire_client_id FROM api.lettres_voiture WHERE id=%s", (lv_id,))
        assert cur.fetchone()[0] == dest_id


def test_articles_reconcilies(conn):
    # 0007 insère « Béton de démolition » ; 0019 le renomme « Béton » (sans doublon).
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.articles WHERE nom='Béton de démolition'")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM bon.articles WHERE nom='Engins'")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM bon.articles WHERE nom='Béton'")
        assert cur.fetchone()[0] == 1
        # Ajouts présents (idempotents).
        for nom in ("Enrobé", "Matériel divers", "Container"):
            cur.execute("SELECT count(*) FROM bon.articles WHERE nom=%s", (nom,))
            assert cur.fetchone()[0] == 1, nom
