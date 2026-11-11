"""Services métier opérant directement sur une connexion SQLite.

Toute la logique testable (création de LV, tours, pré-remplissage, priorité de la
LV préparée, ordre des sites, mémoire d'unité, anti-doublon, undo/redo) vit ici,
indépendamment de la couche HTTP.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from . import numbering
from .geo import haversine_m

FROZEN_STATUSES = {"signee", "facturee"}


# ---------------------------------------------------------------------------
# Helpers génériques
# ---------------------------------------------------------------------------
def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def get_lv(conn: sqlite3.Connection, lv_id: int) -> dict[str, Any] | None:
    return _row_to_dict(
        conn.execute("SELECT * FROM lettres_voiture WHERE id = ?", (lv_id,)).fetchone()
    )


def is_frozen(conn: sqlite3.Connection, lv_id: int) -> bool:
    lv = get_lv(conn, lv_id)
    return bool(lv and lv["statut"] in FROZEN_STATUSES)


# ---------------------------------------------------------------------------
# Lettres de voiture
# ---------------------------------------------------------------------------
def create_lv(
    conn: sqlite3.Connection,
    *,
    projet_id: int,
    client_id: int,
    jour: str,
    chauffeur_id: int | None = None,
    camion_id: int | None = None,
    date_etablissement: str | None = None,
    expediteur: str | None = None,
    destinataire: str | None = None,
    prepared_by_bureau: bool = False,
    heure_debut_regie: str | None = None,
    heure_fin_regie: str | None = None,
) -> int:
    """Crée une LV. Aucun numéro n'est attribué tant qu'il n'y a pas de tour.

    - `date_etablissement` par défaut = `jour` (auto, modifiable tant que non signée).
    - case « destinataire identique à l'expéditeur » cochée d'office.
    """
    cur = conn.execute(
        """
        INSERT INTO lettres_voiture
            (jour, date_etablissement, projet_id, client_id, chauffeur_id, camion_id,
             expediteur, destinataire, dest_identique_exp, prepared_by_bureau,
             heure_debut_regie, heure_fin_regie, statut)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'preparee')
        """,
        (
            jour,
            date_etablissement or jour,
            projet_id,
            client_id,
            chauffeur_id,
            camion_id,
            expediteur,
            destinataire,
            1 if prepared_by_bureau else 0,
            heure_debut_regie,
            heure_fin_regie,
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def set_date_etablissement(
    conn: sqlite3.Connection, lv_id: int, new_date: str, *, actor_key: str, actor_label: str | None = None
) -> None:
    """Modifie la date d'établissement (tracée) tant que la LV n'est pas signée."""
    if is_frozen(conn, lv_id):
        raise PermissionError("LV signée : modification interdite")
    lv = get_lv(conn, lv_id)
    old = lv["date_etablissement"] if lv else None
    conn.execute(
        "UPDATE lettres_voiture SET date_etablissement = ? WHERE id = ?", (new_date, lv_id)
    )
    record_action(
        conn,
        lv_id,
        actor_key=actor_key,
        actor_label=actor_label,
        kind="edit",
        champ="date_etablissement",
        ancienne_valeur=old,
        nouvelle_valeur=new_date,
    )
    conn.commit()


def add_tour(
    conn: sqlite3.Connection,
    lv_id: int,
    *,
    heure_depart: str | None = None,
    gps_lat: float | None = None,
    gps_lon: float | None = None,
    site_chargement_id: int | None = None,
    site_dechargement_id: int | None = None,
) -> dict[str, Any]:
    """Ajoute un tour. Attribue le numéro de LV si c'est le premier tour."""
    if is_frozen(conn, lv_id):
        raise PermissionError("LV signée : ajout de tour interdit")

    numero = numbering.assign_numero(conn, lv_id)  # idempotent

    row = conn.execute(
        "SELECT COALESCE(MAX(ordre), 0) AS m FROM tours WHERE lv_id = ? AND deleted_at IS NULL",
        (lv_id,),
    ).fetchone()
    ordre = int(row["m"]) + 1

    cur = conn.execute(
        """
        INSERT INTO tours (lv_id, ordre, heure_depart, gps_lat, gps_lon,
                           site_chargement_id, site_dechargement_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (lv_id, ordre, heure_depart, gps_lat, gps_lon, site_chargement_id, site_dechargement_id),
    )
    conn.execute(
        "UPDATE lettres_voiture SET statut = 'en_cours' WHERE id = ? AND statut = 'preparee'",
        (lv_id,),
    )
    conn.commit()
    return {"id": int(cur.lastrowid), "ordre": ordre, "numero": numero}


def add_tour_ligne(
    conn: sqlite3.Connection,
    tour_id: int,
    *,
    article_id: int,
    quantite: float,
    unite: str,
    chauffeur_id: int | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO tour_lignes (tour_id, article_id, quantite, unite) VALUES (?, ?, ?, ?)",
        (tour_id, article_id, quantite, unite),
    )
    if chauffeur_id is not None:
        remember_unit(conn, chauffeur_id, article_id, unite)
    conn.commit()
    return int(cur.lastrowid)


def count_tours(conn: sqlite3.Connection, lv_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM tours WHERE lv_id = ? AND deleted_at IS NULL", (lv_id,)
    ).fetchone()
    return int(row["c"])


# ---------------------------------------------------------------------------
# Mémoire de la dernière unité par chauffeur / article
# ---------------------------------------------------------------------------
def remember_unit(conn: sqlite3.Connection, chauffeur_id: int, article_id: int, unite: str) -> None:
    conn.execute(
        """
        INSERT INTO chauffeur_article_unite (chauffeur_id, article_id, derniere_unite, updated_at)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(chauffeur_id, article_id)
        DO UPDATE SET derniere_unite = excluded.derniere_unite,
                      updated_at = excluded.updated_at
        """,
        (chauffeur_id, article_id, unite),
    )
    conn.commit()


def last_unit(conn: sqlite3.Connection, chauffeur_id: int, article_id: int) -> str | None:
    row = conn.execute(
        "SELECT derniere_unite FROM chauffeur_article_unite WHERE chauffeur_id = ? AND article_id = ?",
        (chauffeur_id, article_id),
    ).fetchone()
    return row["derniere_unite"] if row else None


# ---------------------------------------------------------------------------
# Pré-remplissage d'une nouvelle LV (+ priorité de la LV préparée par le bureau)
# ---------------------------------------------------------------------------
def prefill_new_lv(conn: sqlite3.Connection, chauffeur_id: int, jour: str) -> dict[str, Any]:
    """Valeurs par défaut d'un nouveau bon.

    Une LV PRÉPARÉE par le bureau pour ce chauffeur ce jour-là prime : son en-tête
    est renvoyé tel quel (aucun tour n'est jamais créé à l'avance).
    """
    prepared = conn.execute(
        """
        SELECT * FROM lettres_voiture
        WHERE chauffeur_id = ? AND jour = ? AND prepared_by_bureau = 1
          AND deleted_at IS NULL AND statut <> 'annulee'
        ORDER BY id DESC LIMIT 1
        """,
        (chauffeur_id, jour),
    ).fetchone()
    if prepared is not None:
        return {
            "source": "prepared",
            "lv_id": prepared["id"],
            "date_etablissement": prepared["date_etablissement"],
            "camion_id": prepared["camion_id"],
            "client_id": prepared["client_id"],
            "projet_id": prepared["projet_id"],
            "expediteur": prepared["expediteur"],
            "destinataire": prepared["destinataire"],
            "dest_identique_exp": True,
        }

    # Camion attribué au chauffeur.
    ch = conn.execute(
        "SELECT camion_id FROM chauffeurs WHERE id = ?", (chauffeur_id,)
    ).fetchone()
    camion_id = ch["camion_id"] if ch else None

    # Dernier bon du chauffeur (client / projet).
    last = conn.execute(
        """
        SELECT lv.client_id, lv.projet_id, pr.contact_defaut_id
        FROM lettres_voiture lv
        LEFT JOIN projets pr ON pr.id = lv.projet_id
        WHERE lv.chauffeur_id = ? AND lv.deleted_at IS NULL
        ORDER BY lv.id DESC LIMIT 1
        """,
        (chauffeur_id,),
    ).fetchone()

    return {
        "source": "defaults",
        "date_etablissement": jour,
        "camion_id": camion_id,
        "client_id": last["client_id"] if last else None,
        "projet_id": last["projet_id"] if last else None,
        "contact_id": last["contact_defaut_id"] if last else None,
        "dest_identique_exp": True,
    }


# ---------------------------------------------------------------------------
# Ordre de la liste de sites
# ---------------------------------------------------------------------------
def site_list(conn: sqlite3.Connection, chauffeur_id: int, client_id: int) -> list[dict[str, Any]]:
    """Ordre imposé : 5 derniers sites de ce chauffeur pour ce client, puis chantiers
    du client, puis sites communs (par fréquence). Les chantiers « terminés » et les
    sites supprimés sont exclus.
    """
    result: list[dict[str, Any]] = []
    seen: set[int] = set()

    def push(row: sqlite3.Row, bucket: str) -> None:
        if row["id"] in seen:
            return
        seen.add(row["id"])
        d = dict(row)
        d["bucket"] = bucket
        result.append(d)

    # 1) 5 derniers sites utilisés par ce chauffeur pour ce client.
    recents = conn.execute(
        """
        SELECT s.* FROM sites s
        JOIN (
            SELECT site_id, MAX(id) AS last_id FROM (
                SELECT t.site_chargement_id AS site_id, t.id FROM tours t
                JOIN lettres_voiture lv ON lv.id = t.lv_id
                WHERE lv.chauffeur_id = ? AND lv.client_id = ?
                  AND t.site_chargement_id IS NOT NULL AND t.deleted_at IS NULL
                UNION ALL
                SELECT t.site_dechargement_id AS site_id, t.id FROM tours t
                JOIN lettres_voiture lv ON lv.id = t.lv_id
                WHERE lv.chauffeur_id = ? AND lv.client_id = ?
                  AND t.site_dechargement_id IS NOT NULL AND t.deleted_at IS NULL
            ) GROUP BY site_id
        ) u ON u.site_id = s.id
        WHERE s.deleted_at IS NULL AND s.statut <> 'termine'
        ORDER BY u.last_id DESC
        LIMIT 5
        """,
        (chauffeur_id, client_id, chauffeur_id, client_id),
    ).fetchall()
    for r in recents:
        push(r, "recent")

    # 2) Chantiers de ce client.
    chantiers = conn.execute(
        """
        SELECT * FROM sites
        WHERE famille = 'chantier' AND client_id = ?
          AND deleted_at IS NULL AND statut <> 'termine'
        ORDER BY nom
        """,
        (client_id,),
    ).fetchall()
    for r in chantiers:
        push(r, "chantier")

    # 3) Sites communs, par fréquence d'utilisation décroissante.
    communs = conn.execute(
        """
        SELECT s.*, (
            SELECT COUNT(*) FROM tours t
            WHERE (t.site_chargement_id = s.id OR t.site_dechargement_id = s.id)
              AND t.deleted_at IS NULL
        ) AS freq
        FROM sites s
        WHERE s.famille = 'commun' AND s.deleted_at IS NULL AND s.statut <> 'termine'
        ORDER BY freq DESC, s.nom
        """,
    ).fetchall()
    for r in communs:
        push(r, "commun")

    return result


# ---------------------------------------------------------------------------
# Anti-doublon de sites (< 100 m)
# ---------------------------------------------------------------------------
def find_duplicate_site(
    conn: sqlite3.Connection, lat: float, lon: float, *, radius_m: float = 100.0, client_id: int | None = None
) -> dict[str, Any] | None:
    rows = conn.execute(
        "SELECT * FROM sites WHERE deleted_at IS NULL AND lat IS NOT NULL AND lon IS NOT NULL"
    ).fetchall()
    best: dict[str, Any] | None = None
    best_d = radius_m
    for r in rows:
        d = haversine_m(lat, lon, r["lat"], r["lon"])
        if d < best_d:
            best_d = d
            best = dict(r)
            best["distance_m"] = round(d, 1)
    return best


# ---------------------------------------------------------------------------
# Journal d'actions + undo / redo
# ---------------------------------------------------------------------------
def record_action(
    conn: sqlite3.Connection,
    lv_id: int,
    *,
    actor_key: str,
    kind: str,
    actor_label: str | None = None,
    champ: str | None = None,
    ancienne_valeur: Any = None,
    nouvelle_valeur: Any = None,
    via_ia: bool = False,
    is_signature: bool = False,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO lv_actions
            (lv_id, actor_key, actor_label, kind, champ, ancienne_valeur,
             nouvelle_valeur, via_ia, is_signature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            lv_id,
            actor_key,
            actor_label,
            kind,
            champ,
            None if ancienne_valeur is None else str(ancienne_valeur),
            None if nouvelle_valeur is None else str(nouvelle_valeur),
            1 if via_ia else 0,
            1 if is_signature else 0,
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def _last_signature_id(conn: sqlite3.Connection, lv_id: int) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(id), 0) AS m FROM lv_actions WHERE lv_id = ? AND is_signature = 1",
        (lv_id,),
    ).fetchone()
    return int(row["m"])


def undo(conn: sqlite3.Connection, lv_id: int, actor_key: str) -> dict[str, Any] | None:
    """Annule la dernière action de cet acteur, jamais au-delà d'une signature."""
    barrier = _last_signature_id(conn, lv_id)
    row = conn.execute(
        """
        SELECT * FROM lv_actions
        WHERE lv_id = ? AND actor_key = ? AND undone = 0 AND is_signature = 0 AND id > ?
        ORDER BY id DESC LIMIT 1
        """,
        (lv_id, actor_key, barrier),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE lv_actions SET undone = 1 WHERE id = ?", (row["id"],))
    conn.commit()
    return dict(row)


def redo(conn: sqlite3.Connection, lv_id: int, actor_key: str) -> dict[str, Any] | None:
    """Refait la plus ancienne action annulée de cet acteur après la dernière signature."""
    barrier = _last_signature_id(conn, lv_id)
    row = conn.execute(
        """
        SELECT * FROM lv_actions
        WHERE lv_id = ? AND actor_key = ? AND undone = 1 AND is_signature = 0 AND id > ?
        ORDER BY id ASC LIMIT 1
        """,
        (lv_id, actor_key, barrier),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE lv_actions SET undone = 0 WHERE id = ?", (row["id"],))
    conn.commit()
    return dict(row)


def sign_lv(conn: sqlite3.Connection, lv_id: int, *, actor_key: str, actor_label: str | None = None) -> None:
    """Signe (fige) la LV : statut `signee`, pose une barrière d'undo."""
    conn.execute(
        "UPDATE lettres_voiture SET statut = 'signee', "
        "signed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        (lv_id,),
    )
    record_action(
        conn, lv_id, actor_key=actor_key, actor_label=actor_label, kind="signature", is_signature=True
    )
    conn.commit()
