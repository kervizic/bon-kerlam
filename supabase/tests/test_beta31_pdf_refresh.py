"""beta.31 : file de rafraîchissement du cache PDF (bon.lv_pdf_dirty).

Un changement sur une lettre NON signée (ou ses enfants) la marque « à re-rendre » ;
une lettre signée n'est jamais mise en file. Les triggers sont SECURITY DEFINER :
un rôle applicatif (authenticated) déclenche l'écriture sans droit direct sur la file.
"""

from pathlib import Path

from conftest import as_postgres, as_user

ROOT = Path(__file__).resolve().parents[2]
DOWN = ROOT / "supabase" / "down"


def _letter(cur, actors, owner=None, signee=False):
    cur.execute(
        "INSERT INTO bon.lettres_voiture (client_id, owner_email) VALUES (%s,%s) RETURNING id",
        (actors["client_id"], owner or actors["bureau"]),
    )
    lv = cur.fetchone()[0]
    if signee:
        cur.execute("UPDATE bon.lettres_voiture SET documenso_document_id=4242 WHERE id=%s", (lv,))
        cur.execute("UPDATE bon.lettres_voiture SET statut='signee' WHERE id=%s", (lv,))
    return lv


def _dirty(cur, lv):
    cur.execute("SELECT 1 FROM bon.lv_pdf_dirty WHERE lv_id=%s", (lv,))
    return cur.fetchone() is not None


def test_update_entete_marque_dirty(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _letter(cur, actors)
        cur.execute("DELETE FROM bon.lv_pdf_dirty WHERE lv_id=%s", (lv,))
        cur.execute("UPDATE bon.lettres_voiture SET heures_regie='8h-12h' WHERE id=%s", (lv,))
        assert _dirty(cur, lv)
    conn.rollback()


def test_tour_et_enfants_marquent_dirty(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _letter(cur, actors)
        cur.execute("DELETE FROM bon.lv_pdf_dirty WHERE lv_id=%s", (lv,))
        cur.execute("INSERT INTO bon.tours (lv_id, ordre) VALUES (%s,1) RETURNING id", (lv,))
        tour = cur.fetchone()[0]
        assert _dirty(cur, lv)  # l'insertion d'un tour marque la lettre
        cur.execute("DELETE FROM bon.lv_pdf_dirty WHERE lv_id=%s", (lv,))
        cur.execute(
            "INSERT INTO bon.articles (nom) VALUES ('Grave') RETURNING id"
        )
        article = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.tour_lignes (tour_id, article_id, quantite, unite) VALUES (%s,%s,12,'t')",
            (tour, article),
        )
        assert _dirty(cur, lv)  # une ligne de tour marque la lettre parente
    conn.rollback()


def test_lettre_signee_jamais_dirty(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _letter(cur, actors, signee=True)
        cur.execute("DELETE FROM bon.lv_pdf_dirty WHERE lv_id=%s", (lv,))
        # Un archivage (seule écriture permise sur une lettre signée) ne marque pas dirty.
        cur.execute("UPDATE bon.lettres_voiture SET signed_pdf_path='x.pdf' WHERE id=%s", (lv,))
        assert not _dirty(cur, lv)
    conn.rollback()


def test_trigger_security_definer_role_applicatif(conn, actors):
    """Un bureau (authenticated, sans droit sur la file) édite sa lettre : le trigger
    SECURITY DEFINER écrit quand même dans bon.lv_pdf_dirty."""
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _letter(cur, actors, owner=actors["bureau"])
        cur.execute("DELETE FROM bon.lv_pdf_dirty WHERE lv_id=%s", (lv,))
    as_user(conn, actors["bureau"], "authenticated")
    with conn.cursor() as cur:
        cur.execute("UPDATE bon.lettres_voiture SET heures_regie='9h-17h' WHERE id=%s", (lv,))
    as_postgres(conn)
    with conn.cursor() as cur:
        assert _dirty(cur, lv)
    conn.rollback()


def test_down_executable(conn):
    as_postgres(conn)
    sql = (DOWN / "0029_down.sql").read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
        cur.execute("SELECT to_regclass('bon.lv_pdf_dirty')")
        assert cur.fetchone()[0] is None
    conn.rollback()
