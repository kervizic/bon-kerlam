"""Clôture automatique de minuit : les LV en cours de la veille passent à cloturee.

Une LV sans tour est clôturée aussi (tours non bloquants), ce qui est tracé par
l'audit. pg_cron peut remplacer ce mécanisme si l'image le fournit.
"""

from __future__ import annotations

from . import db

CLOSE_SQL = """
UPDATE bon.lettres_voiture
   SET statut = 'cloturee'
 WHERE statut IN ('preparee', 'en_cours')
   AND deleted_at IS NULL
   AND date_etablissement < CURRENT_DATE
RETURNING id
"""


def close_overdue() -> list[int]:
    """Clôture les LV antérieures à aujourd'hui encore ouvertes. Renvoie leurs ids."""
    rows = db.query(CLOSE_SQL)
    return [r["id"] for r in rows]
