"""Pré-remplissage : priorité à la LV préparée, sinon dernier bon du chauffeur."""

from conftest import as_postgres


def test_lv_preparee_prime(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PP') RETURNING id",
            (actors["client_id"],),
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, chauffeur_id, owner_email, preparee, "
            "date_etablissement, expediteur) VALUES (%s,%s,%s,true,CURRENT_DATE,'KERLAM') RETURNING id",
            (projet, actors["chauffeur_id"], actors["chauffeur"]),
        )
        lv = cur.fetchone()[0]
        cur.execute("SELECT bon.prefill(%s)", (actors["chauffeur_id"],))
        r = cur.fetchone()[0]
        assert r["source"] == "preparee"
        assert r["lv_id"] == lv
        assert r["expediteur"] == "KERLAM"


def test_dernier_bon_sinon(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        # chauffeur2 : pas de LV préparée, mais un dernier bon avec projet/camion.
        cur.execute(
            "INSERT INTO bon.chauffeurs (nom, email) VALUES ('B','chauffeur2@kerlam.fr') RETURNING id"
        )
        ch2 = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PD') RETURNING id",
            (actors["client_id"],),
        )
        projet = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, chauffeur_id, owner_email, camion_id, "
            "date_etablissement) VALUES (%s,%s,'chauffeur2@kerlam.fr',%s,CURRENT_DATE - 1) RETURNING id",
            (projet, ch2, actors["camion_id"]),
        )
        cur.execute("SELECT bon.prefill(%s)", (ch2,))
        r = cur.fetchone()[0]
        assert r["source"] == "dernier_bon"
        assert r["projet_id"] == projet
        assert r["camion_id"] == actors["camion_id"]
