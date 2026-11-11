"""Accès Postgres du worker (connexions courtes, rôle bon_worker)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from .config import settings


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def query(sql: str, params: tuple | dict | None = None) -> list[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        if cur.description is None:
            return []
        return cur.fetchall()


def query_one(sql: str, params: tuple | dict | None = None) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def schema_version() -> str | None:
    """Dernière migration appliquée (depuis meta.schema_migrations)."""
    try:
        row = query_one(
            "SELECT max(version) AS v FROM meta.schema_migrations WHERE success"
        )
        return row["v"] if row else None
    except Exception:
        return None
