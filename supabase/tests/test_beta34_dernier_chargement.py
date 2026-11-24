"""beta.34 — reprise des lignes au choix du lieu de chargement.

Vérifie api.dernier_chargement_lignes :
  - renvoie les lignes du DERNIER tour (par date de lettre) partant d'un site ;
  - fonctionne aussi par adresse de chantier (normalisée) ;
  - exclut la corbeille et le tour courant (p_exclude_tour_id) ;
  - respecte la RLS (un chauffeur ne voit que ses lettres) ; une lettre signée
    reste lisible ;
  - l'unité « benne » est stockée telle quelle et ligne_tonnes() renvoie NULL
    (poids non convertible, donc poids partiel, jamais de total faussé).
"""

from conftest import as_postgres, as_user


def _mk_lv(cur, projet, owner, date_etab, statut="en_cours", deleted=False):
    cur.execute(
        "INSERT INTO bon.lettres_voiture (projet_id, owner_email, date_etablissement, statut, deleted_at) "
        "VALUES (%s,%s,%s,%s,%s) RETURNING id",
        (projet, owner, date_etab, statut, (date_etab if deleted else None)),
    )
    return cur.fetchone()[0]


def _add_ligne(cur, tour, article, qte, unite):
    cur.execute(
        "INSERT INTO bon.tour_lignes (tour_id, article_id, quantite, unite) VALUES (%s,%s,%s,%s)",
        (tour, article, qte, unite),
    )


def test_dernier_chargement_lignes(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.articles (nom, unites, created_by) VALUES "
            "('Gravats test', ARRAY['t','m3','benne']::text[], 'test') RETURNING id"
        )
        art = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.sites (nom, portee) VALUES ('Veolia test','commun') RETURNING id")
        site = cur.fetchone()[0]

        projet = actors["projet_id"]
        ch = actors["chauffeur"]

        # Lettre ancienne partant de Veolia : 1 benne gravats.
        lv_old = _mk_lv(cur, projet, ch, "2026-01-01")
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_chargement_id) VALUES (%s,%s) RETURNING id",
            (lv_old, site),
        )
        tour_old = cur.fetchone()[0]
        _add_ligne(cur, tour_old, art, 1, "benne")

        # Lettre plus récente partant de Veolia : 2 bennes gravats (= ce qu'on doit reprendre).
        lv_new = _mk_lv(cur, projet, ch, "2026-03-01")
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_chargement_id) VALUES (%s,%s) RETURNING id",
            (lv_new, site),
        )
        tour_new = cur.fetchone()[0]
        _add_ligne(cur, tour_new, art, 2, "benne")

        # Lettre encore plus récente MAIS en corbeille : doit être ignorée.
        lv_del = _mk_lv(cur, projet, ch, "2026-06-01", deleted=True)
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_chargement_id) VALUES (%s,%s) RETURNING id",
            (lv_del, site),
        )
        tour_del = cur.fetchone()[0]
        _add_ligne(cur, tour_del, art, 99, "t")

    # Vue utilisateur (RLS) : le chauffeur voit ses lettres.
    as_user(conn, ch)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT article_id, article_nom, quantite, unite "
            "FROM api.dernier_chargement_lignes(%s, NULL, NULL) ORDER BY unite",
            (site,),
        )
        rows = cur.fetchall()
        # La corbeille est ignorée : on reprend la lettre de mars (2 bennes), pas celle de juin.
        assert rows == [(art, "Gravats test", 2, "benne")], rows

        # Exclusion du tour courant : si on exclut le tour de mars, on retombe sur janvier.
        cur.execute(
            "SELECT quantite, unite FROM api.dernier_chargement_lignes(%s, NULL, %s)",
            (site, tour_new),
        )
        assert cur.fetchall() == [(1, "benne")]


def test_dernier_chargement_par_adresse_normalisee(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.articles (nom, created_by) VALUES ('Sable test','test') RETURNING id"
        )
        art = cur.fetchone()[0]
        projet, ch = actors["projet_id"], actors["chauffeur"]
        lv = _mk_lv(cur, projet, ch, "2026-02-02")
        cur.execute(
            "INSERT INTO bon.tours (lv_id, chargement_adresse) VALUES (%s,%s) RETURNING id",
            (lv, "12 Rue des Champs, 75001 Paris"),
        )
        tour = cur.fetchone()[0]
        _add_ligne(cur, tour, art, 3, "m3")

    as_user(conn, ch)
    with conn.cursor() as cur:
        # Casse/espaces différents : la comparaison est normalisée (lower(btrim)).
        cur.execute(
            "SELECT quantite, unite FROM api.dernier_chargement_lignes(NULL, %s, NULL)",
            ("  12 RUE DES CHAMPS, 75001 PARIS  ",),
        )
        assert cur.fetchall() == [(3, "m3")]


def test_rls_isolation_entre_chauffeurs(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO bon.sites (nom, portee) VALUES ('Site partagé test','commun') RETURNING id")
        site = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.articles (nom, created_by) VALUES ('Terre test','test') RETURNING id")
        art = cur.fetchone()[0]
        projet = actors["projet_id"]
        # Lettre du chauffeur B (signée) partant du même site.
        lv_b = _mk_lv(cur, projet, actors["chauffeur2"], "2026-05-05", statut="signee")
        cur.execute(
            "INSERT INTO bon.tours (lv_id, site_chargement_id) VALUES (%s,%s) RETURNING id",
            (lv_b, site),
        )
        tour_b = cur.fetchone()[0]
        _add_ligne(cur, tour_b, art, 7, "benne")

    # Le chauffeur A ne voit PAS la lettre du chauffeur B : aucune reprise.
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM api.dernier_chargement_lignes(%s, NULL, NULL)", (site,)
        )
        assert cur.fetchone()[0] == 0

    # Le chauffeur B voit sa propre lettre signée (lecture autorisée).
    as_user(conn, actors["chauffeur2"])
    with conn.cursor() as cur:
        cur.execute(
            "SELECT quantite, unite FROM api.dernier_chargement_lignes(%s, NULL, NULL)", (site,)
        )
        assert cur.fetchall() == [(7, "benne")]


def test_benne_poids_non_convertible(conn, actors):
    """ligne_tonnes() renvoie NULL pour « benne » : poids partiel, pas de total faussé."""
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT bon.ligne_tonnes(2, 'benne', NULL, NULL)")
        assert cur.fetchone()[0] is None
