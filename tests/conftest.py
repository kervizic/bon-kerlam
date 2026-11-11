"""Fixtures de test : base SQLite temporaire migrée + petits helpers de seed."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import db


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    db_path = tmp_path / "test.db"
    db.run_migrations(db_path)
    connection = db.connect(db_path)
    yield connection
    connection.close()


# --- helpers de seed -------------------------------------------------------
def add_camion(conn, immat="GV-398-JH", ptac=15000, vide=6000, volume=10.0):
    cur = conn.execute(
        "INSERT INTO camions (immatriculation, type, ptac_kg, poids_vide_kg, volume_benne_m3) "
        "VALUES (?, '15t bibenne grue', ?, ?, ?)",
        (immat, ptac, vide, volume),
    )
    conn.commit()
    return int(cur.lastrowid)


def add_chauffeur(conn, nom="Swann", camion_id=None, sub="sub-1", email="chauffeur@kerlam.fr"):
    cur = conn.execute(
        "INSERT INTO chauffeurs (nom, camion_id, oidc_sub, oidc_email) VALUES (?, ?, ?, ?)",
        (nom, camion_id, sub, email),
    )
    conn.commit()
    return int(cur.lastrowid)


def add_client(conn, raison="Veolia Franciliane", siren="123456789"):
    cur = conn.execute(
        "INSERT INTO clients (raison_sociale, adresse, siren) VALUES (?, '2 rue de la Plaine, Noisy', ?)",
        (raison, siren),
    )
    conn.commit()
    return int(cur.lastrowid)


def add_projet(conn, client_id, ref_contrat="CW4928", contact_id=None):
    cur = conn.execute(
        "INSERT INTO projets (client_id, ref_contrat, ligne_regie, contact_defaut_id) "
        "VALUES (?, ?, 'Régie Veolia', ?)",
        (client_id, ref_contrat, contact_id),
    )
    conn.commit()
    return int(cur.lastrowid)


def add_site(conn, nom, famille="commun", client_id=None, lat=None, lon=None, statut="actif"):
    cur = conn.execute(
        "INSERT INTO sites (nom, adresse, famille, client_id, lat, lon, statut) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (nom, nom, famille, client_id, lat, lon, statut),
    )
    conn.commit()
    return int(cur.lastrowid)


def add_article(conn, nom="Mortier", unites="t,m3", densite=None, poids_unitaire=None):
    cur = conn.execute(
        "INSERT INTO articles (nom, unites, densite_t_m3, poids_unitaire_t) VALUES (?, ?, ?, ?)",
        (nom, unites, densite, poids_unitaire),
    )
    conn.commit()
    return int(cur.lastrowid)
