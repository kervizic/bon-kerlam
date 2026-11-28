"""beta.36.1 - retrait des documents réglementaires bureau de 0011.

Vérifie : objets absents après migration (tables, vues api, fonctions, policy
storage) ; éléments conservés (bon.chauffeurs.date_sortie, UPDATE pour bon_worker,
« Mes documents » 0034) ; le down recrée les objets à l'identique ; le garde-fou de
0035 refuse le retrait si une table contient une ligne.
"""

from pathlib import Path

import psycopg
import pytest
from conftest import as_postgres

ROOT = Path(__file__).resolve().parents[2]
UP = ROOT / "supabase" / "migrations" / "0035_beta361_retrait_documents_bureau.sql"
DOWN = ROOT / "supabase" / "down" / "0035_down.sql"
TABLES = ("permis", "permis_categories", "fco", "carte_conducteur", "caces")


def _regs(cur):
    out = {}
    for t in TABLES:
        cur.execute("SELECT to_regclass(%s), to_regclass(%s)", (f"bon.{t}", f"api.{t}"))
        out[t] = cur.fetchone()
    cur.execute(
        "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
        "WHERE n.nspname IN ('bon','api') AND p.proname IN ('alertes_documents','purge_documents_chauffeur')"
    )
    return out, cur.fetchone()[0]


def test_objets_retires_et_conserves(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        regs, nfunc = _regs(cur)
        assert all(v == (None, None) for v in regs.values()), regs
        assert nfunc == 0
        cur.execute("SELECT count(*) FROM pg_policies WHERE policyname = 'chauffeur_docs_bureau'")
        assert cur.fetchone()[0] == 0
        cur.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_schema='bon' "
            "AND table_name='chauffeurs' AND column_name='date_sortie'"
        )
        assert cur.fetchone() is not None
        cur.execute("SELECT has_table_privilege('bon_worker', 'bon.chauffeurs', 'UPDATE')")
        assert cur.fetchone()[0] is True
        cur.execute("SELECT to_regclass('bon.documents_chauffeur'), to_regclass('api.documents_chauffeur')")
        assert None not in cur.fetchone()


def test_down_recree_puis_garde_fou(conn):
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(DOWN.read_text(encoding="utf-8"))
        regs, nfunc = _regs(cur)
        assert all(None not in v for v in regs.values()), regs
        assert nfunc == 3
        cur.execute("SELECT count(*) FROM pg_policies WHERE schemaname='bon' AND tablename = ANY(%s)", (list(TABLES),))
        assert cur.fetchone()[0] == 5
        # Rejouer 0035 sur des tables vides : OK (rejouable).
        cur.execute(UP.read_text(encoding="utf-8"))
        cur.execute(DOWN.read_text(encoding="utf-8"))
        # Une ligne présente : le retrait est refusé (aucune donnée perdue).
        cur.execute("INSERT INTO bon.chauffeurs (nom) VALUES ('Test garde-fou') RETURNING id")
        cid = cur.fetchone()[0]
        cur.execute("INSERT INTO bon.caces (chauffeur_id, type) VALUES (%s, 'R482')", (cid,))
        cur.execute("SAVEPOINT s")
        with pytest.raises(psycopg.errors.RaiseException):
            cur.execute(UP.read_text(encoding="utf-8"))
        cur.execute("ROLLBACK TO s")
        cur.execute("SELECT count(*) FROM bon.caces")
        assert cur.fetchone()[0] == 1
    conn.rollback()
