"""Rendu PDF A4 de la lettre de voiture (WeasyPrint).

WeasyPrint dépend de bibliothèques système (Pango, cairo…). L'import est donc
paresseux : si l'environnement local ne les fournit pas, on lève
`PdfUnavailable` et l'appelant peut dégrader (le test local est ignoré, la CI
teste le PDF dans l'image).

Mentions obligatoires (arrêté du 9/11/1999 art. 4) assemblées ici :
a) date d'établissement ; b) transporteur (nom, adresse, SIREN en paramètre) ;
c) date de prise en charge ; d) nature et quantité/poids/volume ; e) expéditeur ;
f) adresse du lieu de chargement ; g) destinataire ; h) adresse du lieu de
déchargement. La zone de signature (44 × 22 mm) est réservée pour Documenso.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"


class PdfUnavailable(RuntimeError):
    """WeasyPrint indisponible (bibliothèques système manquantes)."""


_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


def render_html(context: dict[str, Any]) -> str:
    """Rend le HTML de la LV (réutilisé par le mode contrôle hors ligne côté client)."""
    template = _env.get_template("lv.html")
    return template.render(**context)


def render_pdf(context: dict[str, Any]) -> bytes:
    """Rend le PDF. Lève `PdfUnavailable` si WeasyPrint n'est pas disponible."""
    try:
        from weasyprint import HTML  # import paresseux
    except Exception as exc:  # pragma: no cover - dépend de l'environnement
        raise PdfUnavailable(str(exc)) from exc

    html = render_html(context)
    return HTML(string=html, base_url=str(TEMPLATES_DIR)).write_pdf()


def weasyprint_available() -> bool:
    try:
        import weasyprint  # noqa: F401

        return True
    except Exception:  # pragma: no cover
        return False
