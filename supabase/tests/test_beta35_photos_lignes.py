"""beta.35 — photos « Avant » / « Après » par ligne de marchandise.

Vérifie bon.ligne_photos / api.ligne_photos :
  - RLS : le chauffeur A ne voit pas les photos du chauffeur B ; le bureau voit tout ;
    un utilisateur non listé ne voit rien et ne peut rien ajouter ;
  - ajout autorisé même sur une lettre signée (la lettre n'est pas modifiée) ;
  - suppression : auteur uniquement, refusée sur une lettre signée ;
  - plafond 4 photos par type et par ligne ; cohérence ligne/tour/lettre/chemin ;
  - toute suppression (directe ou cascade ligne/lettre) met les objets storage en file ;
  - purge des photos des tours en corbeille > 30 j ;
  - helpers de chemin storage ; down exécutable.
"""

import uuid
from pathlib import Path

import psycopg
import pytest
from conftest import as_postgres, as_user

ROOT = Path(__file__).resolve().parents[2]
DOWN = ROOT / "supabase" / "down"


def _lv_tour_ligne(cur, actors, owner):
    cur.execute(
        "INSERT INTO bon.lettres_voiture (projet_id, owner_email) VALUES (%s,%s) RETURNING id",
        (actors["projet_id"], owner),
    )
    lv = cur.fetchone()[0]
    cur.execute("INSERT INTO bon.tours (lv_id) VALUES (%s) RETURNING id", (lv,))
    tour = cur.fetchone()[0]
    cur.execute("INSERT INTO bon.tour_lignes (tour_id, quantite, unite) VALUES (%s, 3, 't') RETURNING id", (tour,))
    ligne = cur.fetchone()[0]
    return lv, tour, ligne


def _path(lv, ligne, pid=None):
    return f"lv/{lv}/ligne/{ligne}/{pid or uuid.uuid4()}.jpg"


def _insert(cur, lv, tour, ligne, typ="avant", pid=None):
    pid = pid or str(uuid.uuid4())
    cur.execute(
        "INSERT INTO api.ligne_photos (id, ligne_id, lv_id, tour_id, type, taken_at, lat, lng, accuracy_m, "
        "storage_path, created_by) VALUES (%s,%s,%s,%s,%s, now(), 48.85, 2.35, 12, %s, "
        "COALESCE(bon.current_actor(), 'test')) RETURNING id",
        (pid, ligne, lv, tour, typ, _path(lv, ligne, pid)),
    )
    return cur.fetchone()[0]


def _setup(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        a = _lv_tour_ligne(cur, actors, actors["chauffeur"])
        b = _lv_tour_ligne(cur, actors, actors["chauffeur2"])
    return a, b


def test_rls_chauffeur_a_ne_voit_pas_b(conn, actors):
    a, b = _setup(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        pa = _insert(cur, *a)
    as_user(conn, actors["chauffeur2"])
    with conn.cursor() as cur:
        pb = _insert(cur, *b)
        cur.execute("SELECT id FROM api.ligne_photos")
        assert {r[0] for r in cur.fetchall()} == {pb}
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM api.ligne_photos")
        assert {r[0] for r in cur.fetchall()} == {pa}
        # A ne peut pas photographier la ligne de B.
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            _insert(cur, *b)
        cur.execute("ROLLBACK TO s")
        # A ne peut pas supprimer la photo de B (invisible => 0 ligne).
        cur.execute("DELETE FROM api.ligne_photos WHERE id=%s", (pb,))
        assert cur.rowcount == 0
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM api.ligne_photos WHERE id IN (%s,%s)", (pa, pb))
        assert cur.fetchone()[0] == 2


def test_outsider_et_anon(conn, actors):
    a, _ = _setup(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        _insert(cur, *a)
    as_user(conn, actors["outsider"])
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM api.ligne_photos")
        assert cur.fetchone()[0] == 0
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            _insert(cur, *a)
        cur.execute("ROLLBACK TO s")
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT has_table_privilege('anon', 'api.ligne_photos', 'SELECT'), "
                    "has_table_privilege('anon', 'bon.ligne_photos', 'SELECT')")
        assert cur.fetchone() == (False, False)


def test_created_by_force_a_soi(conn, actors):
    a, _ = _setup(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        pid = str(uuid.uuid4())
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO api.ligne_photos (id, ligne_id, lv_id, tour_id, type, storage_path, created_by) "
                "VALUES (%s,%s,%s,%s,'avant',%s,'bureau@kerlam.fr')",
                (pid, a[2], a[0], a[1], _path(a[0], a[2], pid)),
            )
        cur.execute("ROLLBACK TO s")


def test_signee_ajout_ok_suppression_refusee(conn, actors):
    a, _ = _setup(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        before = _insert(cur, *a, typ="avant")
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("UPDATE bon.lettres_voiture SET statut='signee' WHERE id=%s", (a[0],))
        cur.execute("SELECT updated_at FROM bon.lettres_voiture WHERE id=%s", (a[0],))
        upd = cur.fetchone()[0]
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        after = _insert(cur, *a, typ="apres")  # ajout après signature : autorisé
        cur.execute("DELETE FROM api.ligne_photos WHERE id IN (%s,%s)", (before, after))
        assert cur.rowcount == 0  # suppression refusée par RLS sur lettre signée
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("DELETE FROM api.ligne_photos WHERE id=%s", (after,))
        assert cur.rowcount == 0  # même le bureau (et il n'est pas l'auteur)
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT statut, updated_at FROM bon.lettres_voiture WHERE id=%s", (a[0],))
        assert cur.fetchone() == ("signee", upd)  # la lettre signée n'est pas modifiée


def test_suppression_auteur_seulement(conn, actors):
    a, _ = _setup(conn, actors)
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        pid_bureau = _insert(cur, *a)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        mine = _insert(cur, *a, typ="apres")
        cur.execute("DELETE FROM api.ligne_photos WHERE id=%s", (pid_bureau,))
        assert cur.rowcount == 0
        cur.execute("DELETE FROM api.ligne_photos WHERE id=%s", (mine,))
        assert cur.rowcount == 1
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT bucket, path FROM bon.storage_purge WHERE path LIKE %s ORDER BY path",
                    (f"%{mine}%",))
        rows = cur.fetchall()
        assert [r[0] for r in rows] == ["photos-lignes", "photos-lignes"]
        assert {r[1].rsplit("/", 1)[1] for r in rows} == {f"{mine}.jpg", f"{mine}.thumb.jpg"}


def test_plafond_4_par_type(conn, actors):
    a, _ = _setup(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        for _ in range(4):
            _insert(cur, *a, typ="avant")
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(cur, *a, typ="avant")
        cur.execute("ROLLBACK TO s")
        _insert(cur, *a, typ="apres")  # l'autre type reste libre


def test_coherence_chemin_et_ligne(conn, actors):
    a, b = _setup(conn, actors)
    as_postgres(conn)
    with conn.cursor() as cur:
        # Ligne d'une autre lettre.
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(cur, a[0], a[1], b[2])
        cur.execute("ROLLBACK TO s")
        # Chemin pointant vers une autre lettre.
        pid = str(uuid.uuid4())
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                "INSERT INTO bon.ligne_photos (id, ligne_id, lv_id, tour_id, type, storage_path, created_by) "
                "VALUES (%s,%s,%s,%s,'avant',%s,'x')",
                (pid, a[2], a[0], a[1], _path(b[0], a[2], pid)),
            )
        cur.execute("ROLLBACK TO s")
        # Chemin mal formé (traversée).
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(
                "INSERT INTO bon.ligne_photos (ligne_id, lv_id, tour_id, type, storage_path, created_by) "
                "VALUES (%s,%s,%s,'avant',%s,'x')",
                (a[2], a[0], a[1], f"lv/{a[0]}/ligne/{a[2]}/../x.jpg"),
            )
        cur.execute("ROLLBACK TO s")


def test_cascade_et_purge(conn, actors):
    a, b = _setup(conn, actors)
    as_user(conn, actors["chauffeur"])
    with conn.cursor() as cur:
        p1 = _insert(cur, *a)
    as_postgres(conn)
    with conn.cursor() as cur:
        # Suppression de la ligne => photo supprimée + objets en file.
        cur.execute("DELETE FROM bon.tour_lignes WHERE id=%s", (a[2],))
        cur.execute("SELECT count(*) FROM bon.ligne_photos WHERE id=%s", (p1,))
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM bon.storage_purge WHERE path LIKE %s", (f"%{p1}%",))
        assert cur.fetchone()[0] == 2
        # Tour en corbeille depuis 31 j => purge.
        p2 = _insert(cur, *b)
        cur.execute("UPDATE bon.tours SET deleted_at = now() - interval '31 days' WHERE id=%s", (b[1],))
        cur.execute("SELECT bon.purge_photos_corbeille()")
        assert cur.fetchone()[0] >= 1
        cur.execute("SELECT count(*) FROM bon.ligne_photos WHERE id=%s", (p2,))
        assert cur.fetchone()[0] == 0
        # Lettre supprimée physiquement (ce que fait bon.purge_corbeille sur un
        # brouillon en corbeille > 30 j) : cascade sur les photos + file storage.
        lv, tour, ligne = _lv_tour_ligne(cur, actors, actors["chauffeur"])
        p3 = _insert(cur, lv, tour, ligne)
        cur.execute("DELETE FROM bon.lettres_voiture WHERE id=%s", (lv,))
        cur.execute("SELECT count(*) FROM bon.ligne_photos WHERE id=%s", (p3,))
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM bon.storage_purge WHERE path LIKE %s", (f"%{p3}%",))
        assert cur.fetchone()[0] == 2


def test_file_purge_invisible_aux_clients(conn, actors):
    as_user(conn, actors["bureau"])
    with conn.cursor() as cur:
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("SELECT * FROM bon.storage_purge")
        cur.execute("ROLLBACK TO s")


def test_helpers_chemin(conn, actors):
    a, b = _setup(conn, actors)
    as_postgres(conn)
    with conn.cursor() as cur:
        good = _path(a[0], a[2])
        cur.execute(
            "SELECT bon.photo_path_lv(%s), bon.photo_path_ok(%s), bon.photo_path_ok(%s), "
            "bon.photo_path_lv('lv/1/ligne/2/../../x.jpg'), bon.photo_path_ok(%s)",
            (good, good, good.replace(".jpg", ".thumb.jpg"), _path(a[0], b[2])),
        )
        assert cur.fetchone() == (a[0], True, True, None, False)


def test_pas_d_impact_pdf(conn, actors):
    """Aucune photo ne doit marquer le PDF à re-rendre (template inchangé)."""
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'bon.ligne_photos'::regclass "
            "AND NOT tgisinternal AND tgname NOT IN ('trg_ligne_photos_check','trg_ligne_photos_purge')"
        )
        assert cur.fetchone()[0] == 0


def test_down_executable(conn):
    as_postgres(conn)
    sql = (DOWN / "0033_down.sql").read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
        cur.execute("SELECT to_regclass('bon.ligne_photos'), to_regclass('api.ligne_photos')")
        assert cur.fetchone() == (None, None)
    conn.rollback()
