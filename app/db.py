"""Connexion SQLite (mode WAL) et exécution des migrations numérotées.

Chaque migration est un fichier SQL `app/migrations/NNN_*.sql`. Au démarrage, on
applique dans l'ordre toutes les migrations dont le numéro est supérieur à la
`schema_version` courante. Avant d'appliquer la moindre migration, une copie de
sauvegarde de la base est réalisée via l'API `sqlite3.Connection.backup`.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_MIGRATION_RE = re.compile(r"^(\d+)_.*\.sql$")


def connect(db_path: Path) -> sqlite3.Connection:
    """Ouvre une connexion configurée (WAL, clés étrangères, row factory)."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _current_version(conn: sqlite3.Connection) -> int:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version ("
        " version INTEGER PRIMARY KEY,"
        " applied_at TEXT NOT NULL)"
    )
    row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
    return int(row["v"]) if row and row["v"] is not None else 0


def discover_migrations() -> list[tuple[int, Path]]:
    found: list[tuple[int, Path]] = []
    if not MIGRATIONS_DIR.exists():
        return found
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        m = _MIGRATION_RE.match(path.name)
        if m:
            found.append((int(m.group(1)), path))
    found.sort(key=lambda t: t[0])
    return found


def _backup(db_path: Path) -> Path | None:
    """Copie de sauvegarde de la base avant migration (si la base existe déjà)."""
    if not db_path.exists():
        return None
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    backup_path = db_path.with_name(f"{db_path.stem}.pre-migrate.{stamp}.db")
    src = connect(db_path)
    try:
        dst = sqlite3.connect(backup_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return backup_path


def run_migrations(db_path: Path) -> int:
    """Applique les migrations manquantes. Renvoie la version finale du schéma."""
    migrations = discover_migrations()
    conn = connect(db_path)
    try:
        current = _current_version(conn)
        pending = [(n, p) for (n, p) in migrations if n > current]
    finally:
        conn.close()

    if not pending:
        return current

    _backup(db_path)

    conn = connect(db_path)
    try:
        for number, path in pending:
            sql = path.read_text(encoding="utf-8")
            conn.executescript(sql)
            conn.execute(
                "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
                (number, datetime.now(UTC).isoformat()),
            )
            conn.commit()
        return _current_version(conn)
    finally:
        conn.close()


def schema_version(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    conn = connect(db_path)
    try:
        return _current_version(conn)
    finally:
        conn.close()
