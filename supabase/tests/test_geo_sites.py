"""Anti-doublon de site à 100 m et ordre de la liste de sites."""

from conftest import as_postgres


def test_haversine_et_doublon_100m(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        # Deux points proches (~30 m) et un point lointain.
        cur.execute(
            "INSERT INTO bon.sites (nom, lat, lon, portee) VALUES "
            "('Ref', 48.8566, 2.3522, 'commun')"
        )
        # ~111 m vers le nord (0.001 degré de latitude ~ 111 m) => hors 100 m
        cur.execute("SELECT count(*) FROM bon.site_doublon(48.85670, 2.3522, 100)")
        assert cur.fetchone()[0] == 1  # 0.0001 deg ~ 11 m => doublon
        cur.execute("SELECT count(*) FROM bon.site_doublon(48.85760, 2.3522, 100)")
        assert cur.fetchone()[0] == 0  # ~104 m => pas doublon


def test_sites_pour_ordre(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        client = actors["client_id"]
        chauffeur = actors["chauffeur_id"]
        # Un chantier du client (non utilisé), un site commun (utilisé par le chauffeur).
        cur.execute(
            "INSERT INTO bon.sites (nom, portee, client_id) VALUES ('Chantier X','chantier',%s) RETURNING id",
            (client,),
        )
        chantier = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.sites (nom, portee) VALUES ('Commun Y','commun') RETURNING id"
        )
        commun = cur.fetchone()[0]
        # LV du chauffeur pour ce client, tour utilisant le site commun => devient 'dernier'.
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PS') RETURNING id", (client,)
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, chauffeur_id, owner_email) "
            "VALUES (%s,%s,%s) RETURNING id",
            (projet, chauffeur, actors["chauffeur"]),
        )
        lv = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_chargement_id) VALUES (%s,%s)", (lv, commun)
        )
        cur.execute(
            "SELECT id, source FROM bon.sites_pour(%s,%s)", (chauffeur, client)
        )
        rows = cur.fetchall()
        by_id = {r[0]: r[1] for r in rows}
        # Le site récemment utilisé est en tête (source 1).
        assert rows[0][1] == 1
        assert by_id[commun] == 1
        # Le chantier du client apparaît (source 2).
        assert by_id[chantier] == 2
        # Ordre global croissant par source.
        sources = [r[1] for r in rows]
        assert sources == sorted(sources)
