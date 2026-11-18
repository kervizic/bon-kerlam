"""beta.29 : une lettre signée est immuable (statut + référence Documenso)."""

from pathlib import Path

import psycopg
import pytest
from conftest import as_postgres

ROOT = Path(__file__).resolve().parents[2]
DOWN = ROOT / "supabase" / "down"


def _signee_letter(cur, actors):
    cur.execute("INSERT INTO bon.projets (client_id, nom) VALUES (%s,'P29') RETURNING id", (actors["client_id"],))
    projet = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO bon.lettres_voiture (projet_id, owner_email, documenso_document_id) "
        "VALUES (%s,%s,57) RETURNING id",
        (projet, actors["chauffeur"]),
    )
    lv = cur.fetchone()[0]
    # Passage à signee autorisé (OLD <> 'signee').
    cur.execute("UPDATE bon.lettres_voiture SET statut='signee' WHERE id=%s", (lv,))
    return lv


def test_statut_signee_non_modifiable(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _signee_letter(cur, actors)
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute("UPDATE bon.lettres_voiture SET statut='a_signer' WHERE id=%s", (lv,))
        cur.execute("ROLLBACK TO s")
        # toujours signee
        cur.execute("SELECT statut FROM bon.lettres_voiture WHERE id=%s", (lv,))
        assert cur.fetchone()[0] == "signee"


def test_ref_documenso_non_modifiable(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _signee_letter(cur, actors)
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute("UPDATE bon.lettres_voiture SET documenso_document_id=99 WHERE id=%s", (lv,))
        cur.execute("ROLLBACK TO s")
        cur.execute("SELECT documenso_document_id FROM bon.lettres_voiture WHERE id=%s", (lv,))
        assert cur.fetchone()[0] == 57


def test_archive_signee_autorisee(conn, actors):
    as_postgres(conn)
    with conn.cursor() as cur:
        lv = _signee_letter(cur, actors)
        # L'archivage (signed_pdf_path) reste permis sur une lettre signée.
        cur.execute("UPDATE bon.lettres_voiture SET signed_pdf_path='lettres-signees/57.pdf' WHERE id=%s", (lv,))
        cur.execute("SELECT signed_pdf_path FROM bon.lettres_voiture WHERE id=%s", (lv,))
        assert cur.fetchone()[0] == "lettres-signees/57.pdf"


def test_down_executable(conn):
    as_postgres(conn)
    sql = (DOWN / "0027_down.sql").read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
        cur.execute("SELECT count(*) FROM pg_trigger WHERE tgname='trg_lv_signee_immuable'")
        assert cur.fetchone()[0] == 0
    conn.rollback()
