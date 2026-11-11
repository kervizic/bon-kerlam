"""Jeu de données de démonstration FICTIF (dev uniquement).

Aucune donnée réelle de client ou de salarié. Noms, immatriculations, SIREN et
adresses sont inventés pour que l'application soit explorable en local.
"""

from __future__ import annotations

from pathlib import Path

from . import db


def seed_if_empty(db_path: Path) -> None:
    conn = db.connect(db_path)
    try:
        existing = conn.execute("SELECT COUNT(*) AS c FROM clients").fetchone()["c"]
        if existing:
            return
        _seed(conn)
    finally:
        conn.close()


def _seed(conn) -> None:
    cam = conn.execute(
        "INSERT INTO camions (immatriculation, type, ptac_kg, poids_vide_kg, volume_benne_m3, "
        "ct_echeance, chrono_echeance) VALUES "
        "('AA-123-BB', '15t bibenne grue', 15000, 6200, 10.0, '2027-03-15', '2027-01-20')"
    ).lastrowid
    conn.execute(
        "INSERT INTO camions (immatriculation, type, ptac_kg, poids_vide_kg, volume_benne_m3) "
        "VALUES ('CC-456-DD', '19t ampliroll', 19000, 8100, 12.0)"
    )

    ch = conn.execute(
        "INSERT INTO chauffeurs (nom, tel, email, camion_id, nav_app, fco_echeance, "
        "carte_conducteur_echeance, oidc_email) VALUES "
        "('Démo Chauffeur', '0600000000', 'chauffeur.demo@example.test', ?, 'waze', "
        "'2027-05-01', '2028-02-01', 'chauffeur.demo@example.test')",
        (cam,),
    ).lastrowid

    cl = conn.execute(
        "INSERT INTO clients (raison_sociale, adresse, siren) VALUES "
        "('Régie Démo SAS', '2 rue de la Plaine, 93160 Noisy-le-Grand', '111222333')"
    ).lastrowid
    contact = conn.execute(
        "INSERT INTO contacts (client_id, nom, tel, email, fonction, signataire) VALUES "
        "(?, 'Contact Démo', '0611111111', 'contact.demo@example.test', 'Conducteur de travaux', 1)",
        (cl,),
    ).lastrowid
    pr = conn.execute(
        "INSERT INTO projets (client_id, ref_contrat, ref_ordre_mission, ligne_regie, tarif, "
        "contact_defaut_id, statut) VALUES "
        "(?, 'CW-DEMO-0001', 'OM-2026-07', 'Régie journée 15t', '420 EUR/j', ?, 'actif')",
        (cl, contact),
    ).lastrowid

    conn.execute(
        "INSERT INTO sites (nom, adresse, lat, lon, famille) VALUES "
        "('Dépôt Claye-Souilly', '15 Rue Victor Drouet, 77410 Claye-Souilly', 48.9440, 2.6880, 'commun')"
    )
    conn.execute(
        "INSERT INTO sites (nom, adresse, lat, lon, famille) VALUES "
        "('Yprema Lagny', '6 rue Freycinet, 77400 Lagny-sur-Marne', 48.8730, 2.7050, 'commun')"
    )
    conn.execute(
        "INSERT INTO sites (nom, adresse, lat, lon, famille, client_id) VALUES "
        "('Chantier Démo Gournay', 'Rue du Port, 93460 Gournay-sur-Marne', 48.8620, 2.5540, 'chantier', ?)",
        (cl,),
    )

    conn.execute(
        "INSERT INTO articles (nom, unites, densite_t_m3) VALUES ('Mortier', 't,m3', 2.1)"
    )
    conn.execute(
        "INSERT INTO articles (nom, unites, densite_t_m3) VALUES ('Gravats', 'm3,t', 1.6)"
    )
    conn.execute(
        "INSERT INTO articles (nom, unites, poids_unitaire_t) VALUES ('Parpaing', 'unite', 0.018)"
    )
    conn.commit()
    _ = (ch, pr)
