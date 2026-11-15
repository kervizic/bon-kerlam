"""Quantité estimée de la journée (beta.20) — mention obligatoire (arrêté du
9/11/1999 art. 5 I a). Imprimée en une ligne « X unité » UNIQUEMENT si renseignée ;
formatage du nombre (virgule FR, sans zéros inutiles)."""

from app import pdf


def _context():
    return {
        "transporteur": pdf.TRANSPORTEUR,
        "lv": {
            "numero": "KER-03001",
            "date_etablissement": "2026-11-11",
            "date_prise_en_charge": "2026-11-11",
            "expediteur": "YPREMA Lagny",
            "destinataire": "YPREMA Lagny",
            "dest_identique": True,
            "camion": "GV-398-JH",
            "chauffeur": "Jean",
            "projet": "Régie",
            "heures_regie": "7h-12h",
        },
        "tours": [
            {
                "expediteur": None,
                "destinataire": None,
                "chargement_adresse": "6 rue Freycinet, 77400 Lagny",
                "dechargement_adresse": "2 rue de la Plaine, 93160 Noisy",
                "lignes": [{"nom": "Grave", "quantite": 12, "unite": "t"}],
            }
        ],
    }


def test_fmt_qte_virgule_fr_sans_zeros():
    assert pdf._fmt_qte(12) == "12"
    assert pdf._fmt_qte(12.0) == "12"
    assert pdf._fmt_qte(12.5) == "12,5"
    assert pdf._fmt_qte("8.250") == "8,25"


def test_ligne_quantite_estimee_imprimee_si_renseignee():
    ctx = _context()
    ctx["lv"]["quantite_estimee_aff"] = "12,5 tonnes"
    html = pdf.render_html(ctx)
    assert "Quantité estimée de la journée : 12,5 tonnes" in html


def test_ligne_quantite_estimee_absente_si_vide():
    ctx = _context()
    ctx["lv"]["quantite_estimee_aff"] = ""
    html = pdf.render_html(ctx)
    assert "Quantité estimée de la journée" not in html


def test_ligne_quantite_estimee_absente_si_champ_manquant():
    # Lettre antérieure (colonne non renseignée) : aucune ligne imprimée.
    html = pdf.render_html(_context())
    assert "Quantité estimée de la journée" not in html
