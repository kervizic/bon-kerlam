"""Mémoire de la dernière unité par chauffeur et par article."""

from conftest import as_postgres


def test_memorisation_derniere_unite(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.articles (nom) VALUES ('Sable') RETURNING id")
        art = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PM') RETURNING id",
            (actors["client_id"],),
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, chauffeur_id, owner_email) "
            "VALUES (%s,%s,%s) RETURNING id",
            (projet, actors["chauffeur_id"], actors["chauffeur"]),
        )
        lv = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s) RETURNING id", (lv,))
        tour = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO bon.tour_lignes (tour_id, article_id, quantite, unite) "
            "VALUES (%s,%s,3,'m3') RETURNING id",
            (tour, art),
        )
        ligne = cur.fetchone()[0]
        cur.execute(
            "SELECT bon.derniere_unite_de(%s,%s)", (actors["chauffeur_id"], art)
        )
        assert cur.fetchone()[0] == "m3"

        # Changement d'unité => mémoire mise à jour.
        cur.execute("UPDATE bon.tour_lignes SET unite='t' WHERE id=%s", (ligne,))
        cur.execute(
            "SELECT bon.derniere_unite_de(%s,%s)", (actors["chauffeur_id"], art)
        )
        assert cur.fetchone()[0] == "t"
