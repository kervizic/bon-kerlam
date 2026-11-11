"""Migrations numérotées + undo/redo limité à ses propres actions et bloqué après
signature."""

from __future__ import annotations

from pathlib import Path

from app import db, services

from .conftest import add_camion, add_chauffeur, add_client, add_projet


# --- migrations ------------------------------------------------------------
def test_migrations_apply_and_set_version(tmp_path: Path):
    db_path = tmp_path / "m.db"
    assert db.schema_version(db_path) == 0
    final = db.run_migrations(db_path)
    migrations = db.discover_migrations()
    assert final == max(n for n, _ in migrations)
    assert db.schema_version(db_path) == final


def test_migrations_idempotent_with_backup(tmp_path: Path):
    db_path = tmp_path / "m.db"
    db.run_migrations(db_path)
    v1 = db.schema_version(db_path)
    # Re-run : rien à appliquer, version stable.
    v2 = db.run_migrations(db_path)
    assert v1 == v2


def _lv(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)
    return services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch)


# --- undo / redo -----------------------------------------------------------
def test_undo_only_own_actions(conn):
    lv = _lv(conn)
    services.record_action(conn, lv, actor_key="alice", kind="edit", champ="exp", nouvelle_valeur="A")
    services.record_action(conn, lv, actor_key="bob", kind="edit", champ="dest", nouvelle_valeur="B")
    # Alice ne peut annuler que sa propre action, pas celle de Bob.
    undone = services.undo(conn, lv, "alice")
    assert undone is not None
    assert undone["champ"] == "exp"
    # Plus rien à annuler pour Alice.
    assert services.undo(conn, lv, "alice") is None
    # Bob peut toujours annuler la sienne.
    assert services.undo(conn, lv, "bob")["champ"] == "dest"


def test_redo_restores(conn):
    lv = _lv(conn)
    services.record_action(conn, lv, actor_key="alice", kind="edit", champ="exp", nouvelle_valeur="A")
    services.undo(conn, lv, "alice")
    redone = services.redo(conn, lv, "alice")
    assert redone is not None and redone["champ"] == "exp"
    # Après redo, plus rien à refaire.
    assert services.redo(conn, lv, "alice") is None


def test_undo_blocked_after_signature(conn):
    lv = _lv(conn)
    services.record_action(conn, lv, actor_key="alice", kind="edit", champ="exp", nouvelle_valeur="A")
    services.sign_lv(conn, lv, actor_key="alice")
    # On ne peut pas annuler au-delà d'une signature.
    assert services.undo(conn, lv, "alice") is None


def test_edit_forbidden_after_signature(conn):
    lv = _lv(conn)
    services.sign_lv(conn, lv, actor_key="bureau")
    assert services.is_frozen(conn, lv) is True
    import pytest

    with pytest.raises(PermissionError):
        services.add_tour(conn, lv, heure_depart="07:00")
