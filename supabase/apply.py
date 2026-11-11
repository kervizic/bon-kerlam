#!/usr/bin/env python3
"""Applique les migrations SQL numérotées de supabase/migrations de façon idempotente.

- Table de version `meta.schema_migrations` (version, sha256, applied_at…).
- Refus si le sha256 d'une migration déjà appliquée a changé (dérive).
- Sauvegarde pg_dump compressée AVANT toute application (sauf --no-backup / CI).
- Chaque migration tourne dans sa propre transaction ; échec => arrêt net.

Connexion : variable d'environnement DATABASE_URL (libpq), ou PG* standard.

Usage :
    python supabase/apply.py --status
    python supabase/apply.py --apply            [--no-backup] [--backup-dir DIR]
    python supabase/apply.py --baseline-seed     # marque @baseline:true sans exécuter
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import psycopg

MIG_DIR = Path(__file__).resolve().parent / "migrations"
NAME_RE = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")
HEADER_RE = re.compile(r"^--\s*@(\w+):\s*(.*?)\s*$")

BOOTSTRAP = """
CREATE SCHEMA IF NOT EXISTS meta;
CREATE TABLE IF NOT EXISTS meta.schema_migrations (
  version     text PRIMARY KEY,
  name        text NOT NULL,
  sha256      text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text NOT NULL DEFAULT current_user,
  duration_ms integer,
  success     boolean NOT NULL DEFAULT true
);
"""


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def parse_header(text: str) -> dict[str, str]:
    meta: dict[str, str] = {}
    for line in text.splitlines():
        if not line.startswith("--"):
            if line.strip():
                break  # fin de l'en-tête
            continue
        m = HEADER_RE.match(line)
        if m:
            meta[m.group(1).lower()] = m.group(2)
    return meta


def discover() -> list[dict]:
    out = []
    for p in sorted(MIG_DIR.glob("*.sql")):
        if not NAME_RE.match(p.name):
            continue
        text = p.read_text(encoding="utf-8")
        meta = parse_header(text)
        out.append(
            {
                "version": p.stem,
                "name": meta.get("migration", p.stem),
                "path": p,
                "sql": text,
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "baseline": meta.get("baseline", "false").lower() == "true",
            }
        )
    return out


def connect() -> psycopg.Connection:
    dsn = os.environ.get("DATABASE_URL")
    conn = psycopg.connect(dsn) if dsn else psycopg.connect()
    conn.autocommit = False
    return conn


def applied_map(conn: psycopg.Connection) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT version, sha256 FROM meta.schema_migrations WHERE success")
        return {v: s for v, s in cur.fetchall()}


def bootstrap(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(BOOTSTRAP)
    conn.commit()


def check_drift(migs: list[dict], done: dict[str, str]) -> None:
    for m in migs:
        if m["version"] in done and done[m["version"]] != m["sha256"]:
            log(f"ERREUR dérive : {m['version']} a changé après application.")
            sys.exit(2)


def do_backup(backup_dir: str) -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        log("Sauvegarde ignorée : DATABASE_URL non défini.")
        return
    Path(backup_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    out = Path(backup_dir) / f"pre-migrate-{ts}.sql.gz"
    try:
        proc = subprocess.run(
            ["pg_dump", "--no-owner", dsn], capture_output=True, check=True
        )
        with gzip.open(out, "wb") as fh:
            fh.write(proc.stdout)
        log(f"Sauvegarde -> {out} ({out.stat().st_size} octets)")
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        log(f"Sauvegarde impossible ({exc}). Poursuite tout de même.")


def record(cur, m: dict, duration_ms: int) -> None:
    cur.execute(
        "INSERT INTO meta.schema_migrations (version, name, sha256, duration_ms, success) "
        "VALUES (%s, %s, %s, %s, true) "
        "ON CONFLICT (version) DO UPDATE SET sha256 = EXCLUDED.sha256, "
        "duration_ms = EXCLUDED.duration_ms, success = true",
        (m["version"], m["name"], m["sha256"], duration_ms),
    )


def cmd_apply(baseline_only: bool, backup: bool, backup_dir: str) -> int:
    migs = discover()
    with connect() as conn:
        bootstrap(conn)
        done = applied_map(conn)
        check_drift(migs, done)
        pending = [m for m in migs if m["version"] not in done]
        if baseline_only:
            pending = [m for m in pending if m["baseline"]]
        if not pending:
            log("Aucune migration en attente.")
            return 0
        if backup and not baseline_only:
            do_backup(backup_dir)
        for m in pending:
            execute = m["sql"] if not (baseline_only and m["baseline"]) else None
            with conn.cursor() as cur:
                t0 = datetime.now(UTC)
                if execute is not None:
                    cur.execute(execute)
                dt = int((datetime.now(UTC) - t0).total_seconds() * 1000)
                record(cur, m, dt)
            conn.commit()
            tag = "baseline" if (baseline_only and m["baseline"]) else "appliquée"
            log(f"  {m['version']} {tag} ({m['sha256'][:12]})")
        log(f"{len(pending)} migration(s) traitée(s).")
    return 0


def cmd_status() -> int:
    migs = discover()
    with connect() as conn:
        bootstrap(conn)
        done = applied_map(conn)
        check_drift(migs, done)
        for m in migs:
            mark = "x" if m["version"] in done else " "
            log(f"[{mark}] {m['version']}")
        pending = [m["version"] for m in migs if m["version"] not in done]
        log(f"{len(done)} appliquée(s), {len(pending)} en attente.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--baseline-seed", action="store_true")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--backup-dir", default="backups")
    args = ap.parse_args()

    if args.status:
        return cmd_status()
    if args.apply or args.baseline_seed:
        backup = not args.no_backup and os.environ.get("CI") != "true"
        return cmd_apply(args.baseline_seed, backup, args.backup_dir)
    ap.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
