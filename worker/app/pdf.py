"""Rendu de la lettre de voiture : HTML (Jinja) puis PDF (WeasyPrint).

Le commentaire interne des articles n'est JAMAIS passé au gabarit : seul le nom
de l'article est imprimé. WeasyPrint est importé paresseusement pour que le rendu
HTML (et ses tests) ne dépendent pas des bibliothèques système (pango/cairo).
"""

from __future__ import annotations

import hashlib
import json
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


def _fmt_qte(value) -> str:
    """Nombre lisible : « 12 », « 12,5 » (sans zéros inutiles, virgule FR)."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return str(value)
    s = f"{f:.3f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


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


# Le logo KERLAM figure déjà en tête du PDF : l'adresse ne reprend donc PAS le
# préfixe « KERLAM — » (maquette épurée beta.23). adresse_courte alimente le bloc
# Transporteur des parties.
TRANSPORTEUR = {
    "nom": "KERLAM",
    "adresse": settings.kerlam_adresse,
    "adresse_courte": settings.kerlam_adresse,
    "siren": _format_siren(settings.kerlam_siren),
}

# Séparateurs retirés après le préfixe société dans un nom de site (même logique
# que le front, cf. assets/site-label.js) : tiret demi-cadratin/cadratin, trait
# d'union, point médian, deux-points, virgule, barre oblique, et espaces autour.
_LEADING_SEP = "–—·:,/- \t"


def strip_societe_prefix(nom: str, societe_nom: str) -> str:
    """« Veolia – Noisy » (société « Veolia ») -> « Noisy ». Retire le préfixe
    société PUIS tout séparateur de tête. Rend le nom inchangé si pas de préfixe."""
    s = "" if nom is None else str(nom)
    soc = ("" if societe_nom is None else str(societe_nom)).strip()
    if soc and s.lower().startswith(soc.lower()):
        rest = s[len(soc):]
        if rest == "" or rest[0] in _LEADING_SEP:
            stripped = rest.lstrip(_LEADING_SEP).strip()
            return stripped or s
    return s


def site_label(site_nom: str, societe_nom: str) -> str:
    """Libellé court d'un site : « Société · adresse » (ex. « Cemex · Ivry béton »).
    Sans société : le nom du site tel quel. Chaîne vide si rien."""
    nom = ("" if site_nom is None else str(site_nom)).strip()
    soc = ("" if societe_nom is None else str(societe_nom)).strip()
    if soc:
        short = strip_societe_prefix(nom, soc)
        if short and short.lower() != soc.lower():
            return f"{soc} · {short}"
        return soc
    return nom


def build_context(lv_id: int) -> dict[str, Any]:
    """Construit le contexte du gabarit depuis la base (sans commentaire interne)."""
    lv = db.query_one(
        """
        SELECT lv.id, lv.numero, lv.date_etablissement, lv.date_prise_en_charge,
               lv.expediteur, lv.destinataire, lv.dest_identique,
               lv.destinataire_client_id, lv.heures_regie,
               lv.heures, lv.statut,
               lv.quantite_estimee, lv.quantite_estimee_unite,
               c.immatriculation AS camion, ch.nom AS chauffeur,
               -- beta.30 : projets MULTIPLES par lettre (liaison N-N). Libellé =
               -- nom, ou adresse si le projet n'a pas de nom (« adresse seule »).
               (SELECT array_agg(COALESCE(pr.nom, pr.adresse) ORDER BY lp.created_at, lp.projet_id)
                  FROM bon.lv_projets lp
                  JOIN bon.projets pr ON pr.id = lp.projet_id
                 WHERE lp.lv_id = lv.id) AS projets,
               cl.raison_sociale AS client_nom,
               -- beta.22 : adresse CHOISIE de la société (société -> adresses),
               -- repli sur l'adresse de la fiche client (mono-adresse / ancien modèle).
               COALESCE(ca.adresse, cl.adresse) AS client_adresse,
               dc.raison_sociale AS dest_nom,
               COALESCE(da.adresse, dc.adresse) AS dest_adresse,
               -- beta.29 : nom du contact signataire, imprimé EN DUR sous la
               -- signature (plus de champ NAME côté Documenso).
               ct.nom AS signataire_nom
          FROM bon.lettres_voiture lv
          LEFT JOIN bon.camions c     ON c.id = lv.camion_id
          LEFT JOIN bon.chauffeurs ch ON ch.id = lv.chauffeur_id
          LEFT JOIN bon.projets p     ON p.id = lv.projet_id
          LEFT JOIN bon.contacts ct   ON ct.id = lv.contact_id
          -- Client référencé directement sur la lettre (projet facultatif) ;
          -- repli sur le client du projet pour les lettres non reprises.
          LEFT JOIN bon.clients cl    ON cl.id = COALESCE(lv.client_id, p.client_id)
          -- Destinataire distinct (beta.18) : nom + adresse imprimés sur le PDF.
          LEFT JOIN bon.clients dc    ON dc.id = lv.destinataire_client_id
          -- Adresse choisie (beta.22) : expéditeur et destinataire.
          LEFT JOIN bon.client_adresses ca ON ca.id = lv.client_adresse_id
          LEFT JOIN bon.client_adresses da ON da.id = lv.dest_adresse_id
         WHERE lv.id = %s
        """,
        (lv_id,),
    )
    if lv is None:
        raise ValueError(f"LV introuvable: {lv_id}")

    # beta.30 : récap des projets de la lettre (facultatif). Ligne « Projets : A, B »
    # en en-tête, masquée s'il n'y en a aucun. beta.31.1 : le projet n'est plus affiché
    # par tour, donc plus besoin de compter les projets.
    projets_list = [x for x in (lv.get("projets") or []) if x]
    lv["projets_aff"] = ", ".join(projets_list)

    # Expéditeur (D) : dérivé du CLIENT (raison sociale + adresse), jamais saisi
    # dans l'appli. Repli sur la valeur stockée (lettres anciennes) si pas de client.
    client_parts = [p for p in (lv.get("client_nom"), lv.get("client_adresse")) if p]
    lv["expediteur"] = ", ".join(client_parts) if client_parts else (lv.get("expediteur") or "")

    # Destinataire : identique => reprend l'expéditeur (client). Sinon, destinataire
    # distinct (beta.18) : nom + adresse du client choisi (adresse OBLIGATOIRE —
    # arrêté du 9/11/1999 art. 5). Repli sur la valeur texte stockée pour les
    # lettres anciennes (saisie libre, nom seul).
    if lv["dest_identique"]:
        lv["destinataire"] = lv["expediteur"]
    elif lv.get("dest_nom"):
        dest_parts = [p for p in (lv.get("dest_nom"), lv.get("dest_adresse")) if p]
        lv["destinataire"] = ", ".join(dest_parts)
    else:
        lv["destinataire"] = lv.get("destinataire") or ""

    # beta.23 : si expéditeur et destinataire sont la même société (« Identique
    # au client », ou mêmes nom + adresse), le PDF n'affiche qu'une seule colonne
    # « Expéditeur et destinataire ». Comparaison insensible à la casse/espaces.
    def _norm(s: str) -> str:
        return " ".join(str(s or "").split()).casefold()

    same_parties = bool(lv["expediteur"]) and _norm(lv["expediteur"]) == _norm(lv["destinataire"])

    # Dates au format français JJ/MM/AAAA (le template ne reformate pas). Une
    # seule date « Établie et prise en charge le … » (le jour du transport).
    lv["date_etablissement"] = _fr_date(lv.get("date_etablissement"))
    lv["date_prise_en_charge"] = _fr_date(lv.get("date_prise_en_charge"))
    # beta.23 (maquette épurée) : ligne de date unique. Pas de cas « rattrapage ».
    lv["date"] = lv["date_etablissement"]

    # Heures en créneaux (0017) : chaîne « 8h00–12h00 · 13h00–17h00 ». Repli sur
    # l'ancien texte libre heures_regie pour les lettres antérieures non migrées.
    lv["heures_aff"] = format_creneaux(lv.get("heures")) or (lv.get("heures_regie") or "")

    # beta.22 (E6) : la « Quantité estimée de la journée » n'est plus imprimée sur
    # la lettre de voiture (colonne conservée en base, plus affichée).
    lv["quantite_estimee_aff"] = ""

    # Tours en ordre chronologique (ordre, id). Chaque extrémité porte le NOM du
    # site et sa société (pour le libellé « Société · adresse », beta.23) en plus
    # de l'adresse complète.
    tours = db.query(
        """
        SELECT t.id, t.expediteur, t.destinataire,
               sc.nom AS chargement_site, scs.nom AS chargement_societe,
               -- beta.28 : adresse de chantier libre portée par le tour, sinon
               -- adresse du site permanent. Le site label (chargement_nom) reste
               -- vide pour une adresse libre -> le template affiche l'adresse seule.
               COALESCE(t.chargement_adresse, sc.adresse) AS chargement_adresse,
               sd.nom AS dechargement_site, sds.nom AS dechargement_societe,
               COALESCE(t.dechargement_adresse, sd.adresse) AS dechargement_adresse
          -- beta.31.1 : le projet N'est PLUS imprimé par tour (décision Manu). Le
          -- rattachement tour->projet (t.projet_id) reste en base pour le récap
          -- d'en-tête, mais n'est plus lu ni affiché ici.
          FROM bon.tours t
          LEFT JOIN bon.sites sc ON sc.id = t.site_chargement_id
          LEFT JOIN bon.site_societes scs ON scs.id = sc.societe_id
          LEFT JOIN bon.sites sd ON sd.id = t.site_dechargement_id
          LEFT JOIN bon.site_societes sds ON sds.id = sd.societe_id
         WHERE t.lv_id = %s AND t.deleted_at IS NULL
         ORDER BY t.ordre, t.id
        """,
        (lv_id,),
    )
    for tour in tours:
        # Libellé court du site (« Cemex · Ivry béton ») au-dessus de l'adresse.
        tour["chargement_nom"] = site_label(tour.get("chargement_site"), tour.get("chargement_societe"))
        tour["dechargement_nom"] = site_label(tour.get("dechargement_site"), tour.get("dechargement_societe"))
        # Destinataire du tour affiché seulement s'il diffère de l'en-tête (texte libre).
        dest = (tour.get("destinataire") or "").strip()
        tour["destinataire_nom"] = dest or None
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
            # Quantité au format FR sans zéros inutiles (« 12 », « 3,5 »). Jamais « 12.000 ».
            ligne["quantite_aff"] = _fmt_qte(ligne.get("quantite"))

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
        presta["quantite_aff"] = _fmt_qte(presta.get("quantite"))

    # Bandeau « Non signée » tant que la lettre n'est pas au statut signée.
    signee = lv.get("statut") == "signee"
    return {
        "lv": lv,
        "tours": tours,
        "prestations": prestations,
        "transporteur": TRANSPORTEUR,
        "signee": signee,
        "same_parties": same_parties,
    }


def render_html(context: dict[str, Any]) -> str:
    return _env.get_template("lv.html").render(**context)


def render_document(context: dict[str, Any]):
    """Rend le document WeasyPrint (objet Document). Expose `pages[i].anchors`
    (boîte des ancres #doc-signature / #doc-nom en px, origine haut-gauche) pour
    le placement Documenso mesuré, et `write_pdf()` pour les octets."""
    from weasyprint import HTML  # import paresseux (dépendances système)

    return HTML(string=render_html(context), base_url=_TPL_DIR + os.sep).render()


def render_pdf(context: dict[str, Any]) -> bytes:
    # base_url = dossier des gabarits : permet au @font-face de résoudre
    # l'URL relative vers sarpanch-900.woff2 (logo KERLAM du PDF).
    return render_document(context).write_pdf()


# --- Champs Documenso mesurés sur le rendu WeasyPrint (page.anchors) ----------
# beta.29 : un SEUL champ par lettre (SIGNATURE). Le nom du signataire est imprimé
# en dur dans le PDF (plus de champ NAME Documenso) -> moins d'appels API, plus rapide.
_ANCHORS = (("SIGNATURE", "doc-signature"),)


def anchor_field(field_type: str, page_number: int, box, page_w: float, page_h: float) -> dict:
    """Boîte d'ancre WeasyPrint (x0,y0,x1,y1 px, origine haut-gauche) -> champ
    Documenso en % de page. Fonction pure, testée."""
    x0, y0, x1, y1 = box
    return {
        "type": field_type,
        "pageNumber": page_number,
        "pageX": round(x0 / page_w * 100, 4),
        "pageY": round(y0 / page_h * 100, 4),
        "pageWidth": round((x1 - x0) / page_w * 100, 4),
        "pageHeight": round((y1 - y0) / page_h * 100, 4),
    }


def measure_fields(document, page_offset: int = 0) -> list[dict]:
    """Champs SIGNATURE + NAME mesurés sur les pages d'un rendu (numéros de page
    1-based, décalés de page_offset)."""
    fields: list[dict] = []
    for i, page in enumerate(document.pages):
        for ftype, anchor in _ANCHORS:
            box = page.anchors.get(anchor)
            if box:
                fields.append(anchor_field(ftype, page_offset + i + 1, box, page.width, page.height))
    return fields


def letter_cached(lv_id: int) -> tuple[bytes, list[dict], int]:
    """(pdf, champs page-locaux, nb_pages) d'UNE lettre, depuis le cache si son
    contenu n'a pas changé (clé = hash du HTML rendu, qui détermine entièrement le
    PDF), sinon rend via WeasyPrint et met en cache. Évite le rendu coûteux
    (sous-typage de police) au moment de signer."""
    html = render_html(build_context(lv_id))
    content_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
    row = db.query_one(
        "SELECT pdf, anchors, n_pages FROM bon.lv_pdf_cache WHERE lv_id = %s AND content_hash = %s",
        (lv_id, content_hash),
    )
    if row:
        return bytes(row["pdf"]), row["anchors"], row["n_pages"]
    from weasyprint import HTML

    document = HTML(string=html, base_url=_TPL_DIR + os.sep).render()
    fields_local = measure_fields(document, 0)
    pdf_bytes = document.write_pdf()
    n_pages = len(document.pages)
    db.query(
        "INSERT INTO bon.lv_pdf_cache (lv_id, content_hash, pdf, anchors, n_pages, updated_at) "
        "VALUES (%s, %s, %s, %s, %s, now()) "
        "ON CONFLICT (lv_id) DO UPDATE SET content_hash = EXCLUDED.content_hash, "
        "pdf = EXCLUDED.pdf, anchors = EXCLUDED.anchors, n_pages = EXCLUDED.n_pages, updated_at = now()",
        (lv_id, content_hash, pdf_bytes, json.dumps(fields_local), n_pages),
    )
    return pdf_bytes, fields_local, n_pages


# --- File de rafraîchissement du cache (beta.31) ------------------------------
# Les triggers (migration 0029) marquent une lettre non signée « à re-rendre » dans
# bon.lv_pdf_dirty au moindre changement. Le worker dé-bounce puis rend en fond.


def next_dirty_lv(min_age_seconds: int = 20) -> int | None:
    """lv_id de la plus ancienne lettre en file dont le dernier changement date d'au
    moins `min_age_seconds` (dé-bounce), encore signable (non signée, non supprimée).
    Les lettres en file devenues signées/supprimées sont purgées de la file au passage
    (par process_dirty_once). None si rien n'est prêt."""
    row = db.query_one(
        """
        SELECT d.lv_id
          FROM bon.lv_pdf_dirty d
          JOIN bon.lettres_voiture lv ON lv.id = d.lv_id
         WHERE d.dirty_at <= now() - make_interval(secs => %s)
           AND lv.deleted_at IS NULL AND lv.statut <> 'signee'
         ORDER BY d.dirty_at
         LIMIT 1
        """,
        (min_age_seconds,),
    )
    return row["lv_id"] if row else None


def process_dirty_once(min_age_seconds: int = 20) -> int | None:
    """Traite UNE lettre de la file : re-rend son PDF de cache (si son contenu a
    changé) puis la retire de la file. Purge aussi de la file les lettres devenues
    signées/supprimées (sans les rendre). Renvoie le lv_id traité, ou None si rien."""
    # D'abord, purger les entrées obsolètes (signées/supprimées) pour ne pas tourner
    # en boucle dessus.
    db.query(
        "DELETE FROM bon.lv_pdf_dirty d USING bon.lettres_voiture lv "
        "WHERE lv.id = d.lv_id AND (lv.deleted_at IS NOT NULL OR lv.statut = 'signee')"
    )
    lv_id = next_dirty_lv(min_age_seconds)
    if lv_id is None:
        return None
    # Mémorise l'horodatage courant : on ne retire de la file que si la lettre n'a pas
    # été re-modifiée pendant le rendu.
    stamp = db.query_one("SELECT dirty_at FROM bon.lv_pdf_dirty WHERE lv_id = %s", (lv_id,))
    letter_cached(lv_id)  # rend + met en cache (no-op si le hash n'a pas changé)
    if stamp:
        db.query(
            "DELETE FROM bon.lv_pdf_dirty WHERE lv_id = %s AND dirty_at <= %s",
            (lv_id, stamp["dirty_at"]),
        )
    return lv_id


def drop_cache_for_document(document_id: int) -> int:
    """Supprime l'entrée de cache des lettres d'un document signé (le PDF signé est
    archivé à part). Renvoie le nombre d'entrées retirées."""
    rows = db.query(
        "DELETE FROM bon.lv_pdf_cache c USING bon.lettres_voiture lv "
        "WHERE lv.id = c.lv_id AND lv.documenso_document_id = %s RETURNING c.lv_id",
        (document_id,),
    )
    return len(rows)


def cleanup_cache(days: int = 30) -> dict:
    """Ménage périodique : retire du cache les lettres signées (PDF archivé ailleurs)
    et celles non re-rendues depuis `days` jours. Renvoie le nombre d'entrées et les
    octets libérés."""
    row = db.query_one(
        """
        WITH gone AS (
          DELETE FROM bon.lv_pdf_cache c
           USING bon.lettres_voiture lv
           WHERE lv.id = c.lv_id
             AND (lv.statut = 'signee'
                  OR lv.deleted_at IS NOT NULL
                  OR c.updated_at < now() - make_interval(days => %s))
          RETURNING length(c.pdf) AS n
        )
        SELECT count(*) AS entries, COALESCE(sum(n), 0) AS bytes FROM gone
        """,
        (days,),
    )
    return {"entries": row["entries"] if row else 0, "bytes": int(row["bytes"]) if row else 0}
