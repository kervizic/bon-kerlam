"""Un nouveau tour est pré-rempli : chargement = déchargement du tour précédent ;
le premier tour reste vierge ; un chargement fourni n'est pas écrasé."""

from conftest import as_postgres


def test_prefill_chargement_depuis_dechargement_precedent(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PT') RETURNING id",
            (actors["client_id"],),
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email) VALUES (%s,%s) RETURNING id",
            (projet, actors["chauffeur"]),
        )
        lv = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.sites (nom, portee) VALUES "
            "('A','commun'),('B','commun'),('C','commun')"
        )
        cur.execute("SELECT id, nom FROM bon.sites WHERE nom IN ('A','B','C') ORDER BY nom")
        sites = {n: i for i, n in cur.fetchall()}

        # Tour 1 : chargement vierge, déchargement = B.
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_dechargement_id) VALUES (%s,%s) "
            "RETURNING ordre, site_chargement_id",
            (lv, sites["B"]),
        )
        ordre1, charg1 = cur.fetchone()
        assert ordre1 == 1
        assert charg1 is None  # premier tour vierge

        # Tour 2 : chargement non fourni => pré-rempli avec B (déchargement du tour 1).
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_dechargement_id) VALUES (%s,%s) "
            "RETURNING ordre, site_chargement_id",
            (lv, sites["C"]),
        )
        ordre2, charg2 = cur.fetchone()
        assert ordre2 == 2
        assert charg2 == sites["B"]

        # Tour 3 : chargement fourni explicitement => conservé.
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_chargement_id, site_dechargement_id) "
            "VALUES (%s,%s,%s) RETURNING ordre, site_chargement_id",
            (lv, sites["A"], sites["B"]),
        )
        ordre3, charg3 = cur.fetchone()
        assert ordre3 == 3
        assert charg3 == sites["A"]
