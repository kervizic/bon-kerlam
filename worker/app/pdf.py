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
from .config import settings

_TPL_DIR = os.path.join(os.path.dirname(__file__), "templates")
_env = Environment(
    loader=FileSystemLoader(_TPL_DIR),
    autoescape=select_autoescape(["html"]),
)


def _format_siren(raw: str) -> str:
    """SIREN groupé « 838 377 331 » (9 chiffres) ; sinon valeur telle quelle."""
    digits = "".join(c for c in str(raw or "") if c.isdigit())
    if len(digits) == 9:
        return f"{digits[0:3]} {digits[3:6]} {digits[6:9]}"
    return raw or ""


def unite_label(code: str, quantite) -> str:
    """Libellé d'unité pour le PDF, avec pluriel (« 3 big bags »)."""
    try:
        q = float(quantite)
    except (TypeError, ValueError):
        q = 1
    plural = q > 1
    mapping = {
        "t": "t",
        "m3": "m³",
        "unite": "unités" if plural else "unité",
        "big_bag": "big bags" if plural else "big bag",
        "jour": "jours" if plural else "jour",
        "heure": "heures" if plural else "heure",
    }
    return mapping.get(code, code or "")


def _fr_date(value) -> str:
    """Date au format français JJ/MM/AAAA (depuis une date ou une chaîne ISO)."""
    if not value:
        return ""
    s = str(value)[:10]
    parts = s.split("-")
    if len(parts) == 3 and len(parts[0]) == 4:
        y, m, d = parts
        return f"{d}/{m}/{y}"
    return s


def _fr_heure(value) -> str:
    """Heure « HH:MM » -> « 8h00 » (format court français, sans AM/PM)."""
    s = str(value or "").strip()
    if ":" not in s:
        return s
    h, _, m = s.partition(":")
    try:
        return f"{int(h)}h{int(m):02d}"
    except ValueError:
        return s


def format_creneaux(heures) -> str:
    """Liste de créneaux [{debut,fin}, …] -> « 8h00–12h00 · 13h00–17h00 ».

    Chaîne vide si aucun créneau exploitable. Une fin < début (astreinte, passage
    au lendemain) est rendue telle quelle, sans mention.
    """
    if not heures:
        return ""
    morceaux = []
    for cr in heures:
        if not isinstance(cr, dict):
            continue
        debut = _fr_heure(cr.get("debut"))
        fin = _fr_heure(cr.get("fin"))
        if debut and fin:
            morceaux.append(f"{debut}–{fin}")
        elif debut:
            morceaux.append(debut)
    return " · ".join(morceaux)


TRANSPORTEUR = {
    "nom": "KERLAM",
    "adresse": f"KERLAM — {settings.kerlam_adresse}",
    "siren": _format_siren(settings.kerlam_siren),
}


def build_context(lv_id: int) -> dict[str, Any]:
    """Construit le contexte du gabarit depuis la base (sans commentaire interne)."""
    lv = db.query_one(
        """
        SELECT lv.id, lv.numero, lv.date_etablissement, lv.date_prise_en_charge,
               lv.expediteur, lv.destinataire, lv.dest_identique, lv.heures_regie,
               lv.heures, lv.statut,
               c.immatriculation AS camion, ch.nom AS chauffeur, p.nom AS projet,
               cl.raison_sociale AS client_nom, cl.adresse AS client_adresse
          FROM bon.lettres_voiture lv
          LEFT JOIN bon.camions c     ON c.id = lv.camion_id
          LEFT JOIN bon.chauffeurs ch ON ch.id = lv.chauffeur_id
          LEFT JOIN bon.projets p     ON p.id = lv.projet_id
          LEFT JOIN bon.clients cl    ON cl.id = p.client_id
         WHERE lv.id = %s
        """,
        (lv_id,),
    )
    if lv is None:
        raise ValueError(f"LV introuvable: {lv_id}")

    # Expéditeur (D) : dérivé du CLIENT (raison sociale + adresse), jamais saisi
    # dans l'appli. Repli sur la valeur stockée (lettres anciennes) si pas de client.
    client_parts = [p for p in (lv.get("client_nom"), lv.get("client_adresse")) if p]
    lv["expediteur"] = ", ".join(client_parts) if client_parts else (lv.get("expediteur") or "")

    # Destinataire : identique => reprend l'expéditeur (client) ; sinon valeur saisie.
    if lv["dest_identique"]:
        lv["destinataire"] = lv["expediteur"]
    else:
        lv["destinataire"] = lv.get("destinataire") or ""

    # Dates au format français JJ/MM/AAAA (le template ne reformate pas). Une
    # seule date « Établie et prise en charge le … » (le jour du transport).
    lv["date_etablissement"] = _fr_date(lv.get("date_etablissement"))
    lv["date_prise_en_charge"] = _fr_date(lv.get("date_prise_en_charge"))

    # Heures en créneaux (0017) : chaîne « 8h00–12h00 · 13h00–17h00 ». Repli sur
    # l'ancien texte libre heures_regie pour les lettres antérieures non migrées.
    lv["heures_aff"] = format_creneaux(lv.get("heures")) or (lv.get("heures_regie") or "")

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
        for ligne in tour["lignes"]:
            ligne["unite_aff"] = unite_label(ligne.get("unite"), ligne.get("quantite"))

    # Prestations de la lettre (bloc imprimé avant le récapitulatif des tours).
    # Le commentaire interne des prestations n'est JAMAIS chargé ni imprimé.
    prestations = db.query(
        """
        SELECT p.libelle AS libelle, lp.quantite, lp.unite, m.libelle AS materiel
          FROM bon.lv_prestations lp
          LEFT JOIN bon.prestations p ON p.id = lp.prestation_id
          LEFT JOIN bon.materiels m   ON m.id = lp.materiel_id
         WHERE lp.lv_id = %s
         ORDER BY lp.ordre, lp.id
        """,
        (lv_id,),
    )
    for presta in prestations:
        presta["unite_aff"] = unite_label(presta.get("unite"), presta.get("quantite"))

    # Bandeau « Non signée » tant que la lettre n'est pas au statut signée.
    signee = lv.get("statut") == "signee"
    return {
        "lv": lv,
        "tours": tours,
        "prestations": prestations,
        "transporteur": TRANSPORTEUR,
        "signee": signee,
    }


def render_html(context: dict[str, Any]) -> str:
    return _env.get_template("lv.html").render(**context)


def render_pdf(context: dict[str, Any]) -> bytes:
    from weasyprint import HTML  # import paresseux (dépendances système)

    # base_url = dossier des gabarits : permet au @font-face de résoudre
    # l'URL relative vers sarpanch-900.woff2 (logo KERLAM du PDF).
    return HTML(string=render_html(context), base_url=_TPL_DIR + os.sep).write_pdf()
