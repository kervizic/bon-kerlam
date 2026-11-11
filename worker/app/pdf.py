"""Rendu de la lettre de voiture : HTML (Jinja) puis PDF (WeasyPrint).

Le commentaire interne des articles n'est JAMAIS passé au gabarit : seul le nom
de l'article est imprimé. WeasyPrint est importé paresseusement pour que le rendu
HTML (et ses tests) ne dépendent pas des bibliothèques système (pango/cairo).
"""

from __future__ import annotations

import os
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import db

_TPL_DIR = os.path.join(os.path.dirname(__file__), "templates")
_env = Environment(
    loader=FileSystemLoader(_TPL_DIR),
    autoescape=select_autoescape(["html"]),
)

TRANSPORTEUR = {
    "nom": "KERLAM",
    "adresse": "KERLAM — 15 Rue Victor Drouet, 77410 Claye-Souilly",
    "siren": os.environ.get("KERLAM_SIREN", ""),
}


def build_context(lv_id: int) -> dict[str, Any]:
    """Construit le contexte du gabarit depuis la base (sans commentaire interne)."""
    lv = db.query_one(
        """
        SELECT lv.id, lv.numero, lv.date_etablissement, lv.date_prise_en_charge,
               lv.expediteur, lv.destinataire, lv.dest_identique, lv.heures_regie,
               lv.statut,
               c.immatriculation AS camion, ch.nom AS chauffeur, p.nom AS projet
          FROM bon.lettres_voiture lv
          LEFT JOIN bon.camions c    ON c.id = lv.camion_id
          LEFT JOIN bon.chauffeurs ch ON ch.id = lv.chauffeur_id
          LEFT JOIN bon.projets p    ON p.id = lv.projet_id
         WHERE lv.id = %s
        """,
        (lv_id,),
    )
    if lv is None:
        raise ValueError(f"LV introuvable: {lv_id}")

    # Destinataire identique à l'expéditeur => nom en entier dans les deux champs.
    if lv["dest_identique"] and lv["expediteur"]:
        lv["destinataire"] = lv["expediteur"]

    tours = db.query(
        """
        SELECT t.id, t.expediteur, t.destinataire,
               sc.adresse AS chargement_adresse, sd.adresse AS dechargement_adresse
          FROM bon.tours t
          LEFT JOIN bon.sites sc ON sc.id = t.site_chargement_id
          LEFT JOIN bon.sites sd ON sd.id = t.site_dechargement_id
         WHERE t.lv_id = %s AND t.deleted_at IS NULL
         ORDER BY t.ordre, t.id
        """,
        (lv_id,),
    )
    for tour in tours:
        tour["lignes"] = db.query(
            """
            SELECT a.nom AS nom, tl.quantite, tl.unite
              FROM bon.tour_lignes tl
              LEFT JOIN bon.articles a ON a.id = tl.article_id
             WHERE tl.tour_id = %s
             ORDER BY tl.id
            """,
            (tour["id"],),
        )
    # Bandeau « Non signée » tant que la lettre n'est pas au statut signée.
    signee = lv.get("statut") == "signee"
    return {"lv": lv, "tours": tours, "transporteur": TRANSPORTEUR, "signee": signee}


def render_html(context: dict[str, Any]) -> str:
    return _env.get_template("lv.html").render(**context)


def render_pdf(context: dict[str, Any]) -> bytes:
    from weasyprint import HTML  # import paresseux (dépendances système)

    return HTML(string=render_html(context)).write_pdf()
