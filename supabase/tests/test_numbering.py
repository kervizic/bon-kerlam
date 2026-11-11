"""Numérotation KER-##### : continue, sans trou, attribuée au premier tour."""

from conftest import as_postgres


def _new_lv(cur, projet_id, owner, preparee=False, date="CURRENT_DATE"):
    cur.execute(
        f"INSERT INTO bon.lettres_voiture (projet_id, owner_email, preparee, date_etablissement) "
        f"VALUES (%s,%s,%s,{date}) RETURNING id, numero",
        (projet_id, owner, preparee),
    )
    return cur.fetchone()


def _projet(cur, client_id, nom):
    cur.execute(
        "INSERT INTO bon.projets (client_id, nom) VALUES (%s,%s) RETURNING id",
        (client_id, nom),
    )
    return cur.fetchone()[0]


def test_numero_attribue_au_premier_tour(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        p1 = _projet(cur, actors["client_id"], "P1")
        lv1, numero1 = _new_lv(cur, p1, actors["chauffeur"])
        assert numero1 is None  # pas de numéro avant le premier tour

        cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s)", (lv1,))
        cur.execute("SELECT numero FROM bon.lettres_voiture WHERE id=%s", (lv1,))
        assert cur.fetchone()[0] == "KER-03000"

        # Deuxième tour : pas de nouveau numéro.
        cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s)", (lv1,))
        cur.execute("SELECT numero FROM bon.lettres_voiture WHERE id=%s", (lv1,))
        assert cur.fetchone()[0] == "KER-03000"


def test_pas_de_trou_et_lv_preparee_ne_consomme_pas(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        p1 = _projet(cur, actors["client_id"], "P1")
        p2 = _projet(cur, actors["client_id"], "P2")
        p3 = _projet(cur, actors["client_id"], "P3")

        # LV préparée sans tour : ne consomme pas de numéro.
        lv_prep, _ = _new_lv(cur, p3, actors["chauffeur"], preparee=True)

        lv1, _ = _new_lv(cur, p1, actors["chauffeur"])
        cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s)", (lv1,))
        lv2, _ = _new_lv(cur, p2, actors["chauffeur"])
        cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s)", (lv2,))

        cur.execute(
            "SELECT numero FROM bon.lettres_voiture WHERE id IN (%s,%s) ORDER BY id",
            (lv1, lv2),
        )
        nums = [r[0] for r in cur.fetchall()]
        assert nums == ["KER-03000", "KER-03001"]  # continu, sans trou

        # La LV préparée supprimée n'a jamais pris de numéro.
        cur.execute("SELECT numero FROM bon.lettres_voiture WHERE id=%s", (lv_prep,))
        assert cur.fetchone()[0] is None
        cur.execute("DELETE FROM bon.lettres_voiture WHERE id=%s", (lv_prep,))
        cur.execute("SELECT next_value FROM bon.lv_counter WHERE id=1")
        assert cur.fetchone()[0] == 3002  # 3000 et 3001 consommés, rien d'autre


def test_lv_annulee_garde_son_numero(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        p1 = _projet(cur, actors["client_id"], "P1")
        lv1, _ = _new_lv(cur, p1, actors["chauffeur"])
        cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s)", (lv1,))
        cur.execute("UPDATE bon.lettres_voiture SET statut='annulee' WHERE id=%s", (lv1,))
        cur.execute("SELECT numero FROM bon.lettres_voiture WHERE id=%s", (lv1,))
        assert cur.fetchone()[0] == "KER-03000"
