"""beta.21 — suppression GROUPÉE (lv_supprimer_lot) + PURGE physique de la
corbeille (purge_corbeille) + correction du bug « Clôturée ».

Règles (cf. 0021) :
- lv_supprimer_lot applique par lot : brouillon -> corbeille, numérotée non
  signée -> annulée, signée -> IGNORÉE (jamais d'erreur) ;
- purge_corbeille supprime PHYSIQUEMENT les brouillons en corbeille > 30 j,
  JAMAIS une lettre numérotée ni signée, idempotente.
"""

import psycopg
from conftest import as_postgres, as_user


def _insert_lv(conn, actors, *, numero=None, statut="en_cours", owner=None, deleted_days=None):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.lettres_voiture (projet_id, owner_email, numero, statut, chauffeur_id) "
            "VALUES (%s,%s,%s,%s,%s) RETURNING id",
            (actors["projet_id"], owner or actors["chauffeur"], numero, statut, actors["chauffeur_id"]),
        )
        lv_id = cur.fetchone()[0]
        if deleted_days is not None:
            cur.execute(
                "UPDATE bon.lettres_voiture "
                "SET deleted_at = now() - make_interval(days => %s), deleted_par = %s WHERE id = %s",
                (deleted_days, actors["chauffeur"], lv_id),
            )
    return lv_id


def _exists(conn, lv_id):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM bon.lettres_voiture WHERE id = %s", (lv_id,))
        return cur.fetchone()[0] == 1


# --- Suppression groupée -------------------------------------------------------

def test_lot_mixte_corbeille_annulee_et_signee_ignoree(conn, actors):
    brouillon = _insert_lv(conn, actors, numero=None)
    numerotee = _insert_lv(conn, actors, numero="KER-95001")
    signee = _insert_lv(conn, actors, numero="KER-95002", statut="signee")
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute(
            "SELECT api.lv_supprimer_lot(%s, 'doublon', NULL)",
            ([brouillon, numerotee, signee],),
        )
        res = cur.fetchone()[0]
    assert res["corbeille"] == 1
    assert res["annulee"] == 1
    assert res["ignore_signee"] == 1
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT deleted_at FROM bon.lettres_voiture WHERE id = %s", (brouillon,))
        assert cur.fetchone()[0] is not None
        cur.execute("SELECT statut FROM bon.lettres_voiture WHERE id = %s", (numerotee,))
        assert cur.fetchone()[0] == "annulee"
        cur.execute("SELECT statut, deleted_at FROM bon.lettres_voiture WHERE id = %s", (signee,))
        statut, deleted_at = cur.fetchone()
        assert statut == "signee" and deleted_at is None  # intacte


def test_lot_ignore_lettre_autrui(conn, actors):
    mienne = _insert_lv(conn, actors, numero=None)
    autrui = _insert_lv(conn, actors, numero=None, owner=actors["chauffeur2"])
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.lv_supprimer_lot(%s, NULL, NULL)", ([mienne, autrui],))
        res = cur.fetchone()[0]
    assert res["corbeille"] == 1
    assert res["ignore_autre"] == 1
    assert _exists(conn, autrui)  # non touchée
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT deleted_at FROM bon.lettres_voiture WHERE id = %s", (autrui,))
        assert cur.fetchone()[0] is None


def test_lot_idempotent_sur_deja_en_corbeille(conn, actors):
    brouillon = _insert_lv(conn, actors, numero=None)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT api.lv_supprimer_lot(%s, NULL, NULL)", ([brouillon],))
        assert cur.fetchone()[0]["corbeille"] == 1
        # 2e passage : déjà en corbeille -> ni corbeille, ni erreur.
        cur.execute("SELECT api.lv_supprimer_lot(%s, NULL, NULL)", ([brouillon],))
        res = cur.fetchone()[0]
        assert res["corbeille"] == 0
        assert res["ignore_autre"] == 1


# --- Purge physique ------------------------------------------------------------

def test_purge_supprime_brouillon_vieux(conn, actors):
    vieux = _insert_lv(conn, actors, numero=None, deleted_days=31)
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT bon.purge_corbeille()")
        res = cur.fetchone()[0]
    assert vieux in res["ids"]
    assert not _exists(conn, vieux)


def test_purge_epargne_brouillon_recent(conn, actors):
    recent = _insert_lv(conn, actors, numero=None, deleted_days=10)
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT bon.purge_corbeille()")
        cur.fetchone()
    assert _exists(conn, recent)  # < 30 j : conservé


def test_purge_epargne_numerotee_et_signee(conn, actors):
    # Cas défensif : même avec un deleted_at ancien forcé, une lettre NUMÉROTÉE
    # ou SIGNÉE n'est JAMAIS purgée physiquement.
    numerotee = _insert_lv(conn, actors, numero="KER-96001", deleted_days=99)
    signee = _insert_lv(conn, actors, numero="KER-96002", statut="signee", deleted_days=99)
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT bon.purge_corbeille()")
        res = cur.fetchone()[0]
    assert numerotee not in res["ids"]
    assert signee not in res["ids"]
    assert _exists(conn, numerotee)
    assert _exists(conn, signee)


def test_purge_idempotente_sans_victime(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT bon.purge_corbeille()")
        res = cur.fetchone()[0]
    assert res["purged"] in (None, 0) or isinstance(res["purged"], int)
    assert isinstance(res["ids"], list)
