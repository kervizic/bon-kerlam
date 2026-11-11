"""Rendu HTML de la LV : commentaire interne absent, nom d'article présent,
destinataire identique recopié en entier (jamais « idem »)."""

from app import pdf


def _context():
    return {
        "transporteur": pdf.TRANSPORTEUR,
        "lv": {
            "numero": "KER-03000",
            "date_etablissement": "2026-11-11",
            "date_prise_en_charge": "2026-11-11",
            "expediteur": "YPREMA Lagny",
            "destinataire": "YPREMA Lagny",
            "dest_identique": True,
            "camion": "GV-398-JH",
            "chauffeur": "Jean",
            "projet": "Régie Franciliane",
            "heures_regie": "7h-12h",
        },
        "tours": [
            {
                "expediteur": None,
                "destinataire": None,
                "chargement_adresse": "6 rue Freycinet, 77400 Lagny",
                "dechargement_adresse": "2 rue de la Plaine, 93160 Noisy",
                "lignes": [
                    {"nom": "Grave", "quantite": 12, "unite": "t"},
                ],
            }
        ],
    }


def test_commentaire_interne_absent_du_pdf():
    ctx = _context()
    # On ajoute un commentaire interne au contexte brut : il ne doit PAS ressortir.
    secret = "SECRET-NE-PAS-IMPRIMER-170101"
    ctx["tours"][0]["lignes"][0]["commentaire_interne"] = secret
    html = pdf.render_html(ctx)
    assert "Grave" in html            # le nom est imprimé
    assert secret not in html         # le commentaire interne ne l'est jamais


def test_destinataire_identique_recopie():
    html = pdf.render_html(_context())
    # Le nom complet apparaît dans les deux blocs, jamais « idem ».
    assert html.count("YPREMA Lagny") >= 2
    assert "idem" not in html.lower()


def test_zone_signature_reservee():
    html = pdf.render_html(_context())
    assert "sign-box" in html         # emplacement 44 x 22 mm pour Documenso
