"""Rendu PDF : le HTML est toujours testé ; le PDF réel n'est testé que si
WeasyPrint est disponible (sinon ignoré en local, couvert par la CI dans l'image)."""

from __future__ import annotations

import pytest

from app import pdf


def _context() -> dict:
    return {
        "lv": {
            "numero": "KER-03000", "date_etablissement": "2026-11-11",
            "date_prise_en_charge": "2026-11-11", "expediteur": "Régie Démo",
            "destinataire": None, "dest_identique_exp": 1,
            "heure_debut_regie": "07:00", "heure_fin_regie": "16:00",
        },
        "camion": {"immatriculation": "AA-123-BB", "type": "15t"},
        "chauffeur": {"nom": "Démo Chauffeur"},
        "projet": {"ref_contrat": "CW-DEMO-0001", "ligne_regie": "Régie journée"},
        "tours": [{
            "ordre": 1, "heure_depart": "07:00",
            "chargement_adresse": "Dépôt Claye", "dechargement_adresse": "Yprema Lagny",
            "lignes": [{"article": "Mortier", "quantite": 5, "unite": "t"}],
        }],
        "destinataire_affiche": "Régie Démo",
        "carrier": {"name": "KERLAM", "address": "15 Rue Victor Drouet, 77410 Claye-Souilly",
                    "siren": "000000000"},
        "app": {"name": "bon.kerlam.fr", "version": "0.1.0-beta.1"},
        "masse_totale_t": 11.2, "ptac_t": 15.0,
    }


def test_render_html_contains_required_mentions():
    html = pdf.render_html(_context())
    # Mentions obligatoires de la lettre de voiture.
    assert "KERLAM" in html
    assert "15 Rue Victor Drouet" in html
    assert "SIREN" in html
    assert "KER-03000" in html
    assert "Date d'établissement" in html
    # Zone de signature réservée (Documenso).
    assert "sign-box" in html
    # Destinataire écrit en entier, jamais « idem ».
    assert "Régie Démo" in html
    assert "idem" not in html.lower()


@pytest.mark.skipif(not pdf.weasyprint_available(), reason="WeasyPrint indisponible en local")
def test_render_pdf_bytes():
    data = pdf.render_pdf(_context())
    assert data[:4] == b"%PDF"
