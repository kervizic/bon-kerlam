"""Maintenance nocturne des lettres de voiture.

beta.21 (correction du bug « Clôturée ») : l'ANCIENNE clôture automatique de
minuit passait en 'cloturee' TOUTE lettre de la veille encore ouverte — y
compris les brouillons sans numéro et les lettres numérotées non signées — ce
qui faisait apparaître un badge « Clôturée » trompeur (incident Manu 16/11).

Décision : on NE clôture plus automatiquement. Une lettre reste dans son état
réel (brouillon / en cours) jusqu'à ce que l'utilisateur agisse (signature).
`close_overdue` est CONSERVÉE (endpoint manuel + rétro-compat) mais DURCIE : elle
n'affecte JAMAIS un brouillon (numero IS NULL). Rien dans l'app ne dépend du
statut 'cloturee' (simple libellé d'affichage), la bascule est donc réversible.

La maintenance nocturne effective est désormais la PURGE physique des brouillons
en corbeille depuis plus de 30 jours (via la fonction SQL bon.purge_corbeille,
journalisée par l'audit ; jamais une lettre numérotée ni signée).
"""

from __future__ import annotations

from . import db

# Durcie : un brouillon (numero IS NULL) n'est JAMAIS clôturé automatiquement.
# Appelée uniquement par l'endpoint manuel POST /worker/close-midnight ; plus
# aucun ordonnanceur ne l'invoque (cf. main._maintenance_loop).
CLOSE_SQL = """
UPDATE bon.lettres_voiture
   SET statut = 'cloturee'
 WHERE statut IN ('preparee', 'en_cours')
   AND deleted_at IS NULL
   AND numero IS NOT NULL
   AND date_etablissement < CURRENT_DATE
RETURNING id
"""


def close_overdue() -> list[int]:
    """Clôture MANUELLE des lettres NUMÉROTÉES antérieures à aujourd'hui encore
    ouvertes (jamais un brouillon). Renvoie leurs ids. Non planifiée."""
    rows = db.query(CLOSE_SQL)
    return [r["id"] for r in rows]


def purge_corbeille() -> dict:
    """Purge physique des brouillons en corbeille depuis plus de 30 jours.

    Déléguée à la fonction SQL bon.purge_corbeille (garde-fous déterministes,
    cascade FK, journal d'audit). Idempotente. Renvoie {'purged': n, 'ids': [...]}.
    """
    rows = db.query("SELECT bon.purge_corbeille() AS r")
    return rows[0]["r"] if rows else {"purged": 0, "ids": []}
