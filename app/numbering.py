"""Numérotation des lettres de voiture.

Le numéro (format `KER-#####`, 5 chiffres, compteur continu démarrant à 3000) est
attribué au PREMIER TOUR seulement : une LV préparée sans tour ne consomme pas de
numéro. Le compteur n'est incrémenté qu'au moment réel de l'attribution, ce qui
garantit l'absence de trou. Une LV annulée garde son numéro.
"""

from __future__ import annotations

import sqlite3

PREFIX = "KER-"
WIDTH = 5


def format_numero(value: int, prefix: str = PREFIX, width: int = WIDTH) -> str:
    return f"{prefix}{value:0{width}d}"


def peek_next(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT next_value FROM lv_counter WHERE id = 1").fetchone()
    return int(row["next_value"])


def assign_numero(
    conn: sqlite3.Connection,
    lv_id: int,
    *,
    prefix: str = PREFIX,
    width: int = WIDTH,
) -> str:
    """Attribue (si besoin) un numéro à la LV lors de la création de son premier tour.

    Idempotent : si la LV a déjà un numéro, on le renvoie sans consommer le compteur.
    """
    row = conn.execute(
        "SELECT numero FROM lettres_voiture WHERE id = ?", (lv_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"Lettre de voiture introuvable: {lv_id}")
    if row["numero"]:
        return row["numero"]

    counter = conn.execute(
        "SELECT next_value FROM lv_counter WHERE id = 1"
    ).fetchone()
    value = int(counter["next_value"])
    numero = format_numero(value, prefix=prefix, width=width)

    conn.execute(
        "UPDATE lettres_voiture SET numero = ? WHERE id = ?", (numero, lv_id)
    )
    conn.execute(
        "UPDATE lv_counter SET next_value = next_value + 1 WHERE id = 1"
    )
    return numero
