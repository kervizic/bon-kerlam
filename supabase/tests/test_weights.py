"""Estimation de poids et seuils 100 % / 105 % du PTAC (simple affichage)."""

from conftest import as_postgres


def _lv_with_lines(cur, actors, lines):
    """lines: list de (nom_article, quantite, unite, densite, poids_unitaire)."""
    cur.execute(
        "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'PW') RETURNING id",
        (actors["client_id"],),
    )
    projet = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO bon.lettres_voiture (projet_id, camion_id, owner_email) "
        "VALUES (%s,%s,%s) RETURNING id",
        (projet, actors["camion_id"], actors["chauffeur"]),
    )
    lv = cur.fetchone()[0]
    cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s) RETURNING id", (lv,))
    tour = cur.fetchone()[0]
    for nom, q, u, dens, pu in lines:
        cur.execute(
            "INSERT INTO bon.articles (nom, densite_t_m3, poids_unitaire_t) "
            "VALUES (%s,%s,%s) RETURNING id",
            (nom, dens, pu),
        )
        art = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.tour_lignes (tour_id, article_id, quantite, unite) "
            "VALUES (%s,%s,%s,%s)",
            (tour, art, q, u),
        )
    cur.execute("SELECT bon.lv_poids(%s)", (lv,))
    return cur.fetchone()[0]


def test_gauge_ok(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        # 7 t à vide + 4 t => 11 t sur 15 t PTAC => ratio ~0.73 => ok
        r = _lv_with_lines(cur, actors, [("G", 4, "t", None, None)])
        assert r["masse_totale_t"] == 11.0
        assert r["gauge"] == "ok"
        assert r["poids_partiel"] is False


def test_gauge_warn_a_100pct(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        # 7 + 8 = 15 t = 100 % => warn (orange)
        r = _lv_with_lines(cur, actors, [("G", 8, "t", None, None)])
        assert r["ratio"] == 1.0
        assert r["gauge"] == "warn"


def test_gauge_danger_a_105pct(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        # 7 + 8.75 = 15.75 t = 105 % => danger (rouge)
        r = _lv_with_lines(cur, actors, [("G", 8.75, "t", None, None)])
        assert r["ratio"] == 1.05
        assert r["gauge"] == "danger"


def test_m3_densite_et_poids_partiel(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        # ligne m3 avec densité 1.5 => 2 m3 = 3 t ; ligne m3 sans densité => partiel
        r = _lv_with_lines(
            cur,
            actors,
            [("Dense", 2, "m3", 1.5, None), ("SansDensite", 5, "m3", None, None)],
        )
        assert r["chargement_t"] == 3.0
        assert r["poids_partiel"] is True
        assert r["lignes_non_comptees"] == 1
