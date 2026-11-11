"""Fixtures des tests base de données (Postgres de service CI).

Les migrations sont appliquées une fois par session via supabase/apply.py (ce qui
teste aussi le runner). Chaque test tourne dans une transaction annulée à la fin
=> isolation sans toucher au seed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[2]
APPLY = ROOT / "supabase" / "apply.py"


def _dsn() -> str:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        pytest.skip("DATABASE_URL non défini (test base nécessaire).")
    return dsn


@pytest.fixture(scope="session", autouse=True)
def migrated() -> None:
    dsn = _dsn()
    env = {**os.environ, "DATABASE_URL": dsn, "CI": "true"}
    r = subprocess.run(
        [sys.executable, str(APPLY), "--apply", "--no-backup"],
        env=env, capture_output=True, text=True,
    )
    sys.stderr.write(r.stderr)
    assert r.returncode == 0, f"apply.py a échoué: {r.stderr}"
    # Rejouabilité : un second passage ne doit rien appliquer.
    r2 = subprocess.run(
        [sys.executable, str(APPLY), "--apply", "--no-backup"],
        env=env, capture_output=True, text=True,
    )
    assert r2.returncode == 0
    assert "Aucune migration en attente" in r2.stderr


@pytest.fixture
def conn():
    c = psycopg.connect(_dsn())
    c.autocommit = False
    try:
        yield c
    finally:
        c.rollback()
        c.close()


def as_user(conn, email: str | None, role: str = "authenticated") -> None:
    """Bascule la connexion dans le rôle `authenticated` avec un JWT simulé."""
    with conn.cursor() as cur:
        cur.execute("RESET ROLE;")
        if email is None:
            claims = json.dumps({"role": role})
        else:
            claims = json.dumps({"role": role, "email": email, "sub": str(uuid.uuid4())})
        cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims,))
        cur.execute("SET LOCAL ROLE authenticated;")


def as_postgres(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("RESET ROLE;")
        cur.execute("SELECT set_config('request.jwt.claims', NULL, true)")


@pytest.fixture
def actors(conn):
    """Crée (en superuser) un bureau, un chauffeur, laisse un outsider non listé.

    Renvoie un dict d'e-mails + ids utiles.
    """
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO bon.utilisateurs (email, role, nom, actif) VALUES "
            "('bureau@kerlam.fr','bureau','Bureau',true),"
            "('chauffeur@kerlam.fr','chauffeur','Chauffeur A',true),"
            "('chauffeur2@kerlam.fr','chauffeur','Chauffeur B',true),"
            "('off@kerlam.fr','desactive','Desactive',true)"
        )
        cur.execute(
            "INSERT INTO bon.camions (immatriculation, type, ptac_kg, poids_vide_kg, volume_benne_m3) "
            "VALUES ('GV-398-JH','15t bibenne grue',15000,7000,10) RETURNING id"
        )
        camion_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.chauffeurs (nom, email, camion_id) VALUES "
            "('Chauffeur A','chauffeur@kerlam.fr',%s) RETURNING id", (camion_id,)
        )
        chauffeur_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.clients (raison_sociale) VALUES ('Veolia') RETURNING id"
        )
        client_id = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO bon.projets (client_id, nom) VALUES (%s,'Régie Franciliane') RETURNING id",
            (client_id,),
        )
        projet_id = cur.fetchone()[0]
    return {
        "bureau": "bureau@kerlam.fr",
        "chauffeur": "chauffeur@kerlam.fr",
        "chauffeur2": "chauffeur2@kerlam.fr",
        "outsider": "inconnu@gmail.com",
        "desactive": "off@kerlam.fr",
        "camion_id": camion_id,
        "chauffeur_id": chauffeur_id,
        "client_id": client_id,
        "projet_id": projet_id,
    }
