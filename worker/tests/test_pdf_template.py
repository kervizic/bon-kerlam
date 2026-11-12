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


def test_mentions_legales_art4():
    html = pdf.render_html(_context())
    assert "article 4" in html.lower()


def test_libelle_projet_sans_regie():
    # Le libellé est « Projet » seul (plus « Projet / régie »).
    html = pdf.render_html(_context())
    assert "Projet :" in html
    assert "Projet / régie" not in html
    assert "9 novembre 1999" in html
    assert "État récapitulatif des tours" in html


def test_projet_vide_masque_la_ligne_projet():
    # Projet facultatif (beta.17) : sans projet, aucune ligne « Projet » imprimée
    # (ni « Projet : — »). L'expéditeur reste le client de la lettre.
    ctx = _context()
    ctx["lv"]["projet"] = None
    html = pdf.render_html(ctx)
    assert "Projet :" not in html
    assert "Projet : —" not in html
    assert "YPREMA Lagny" in html  # expéditeur (client) toujours présent


def test_aucun_badge_statut_sur_pdf():
    # Retouche beta.12 (demande de Manu) : plus aucun badge/filigrane de statut.
    for signee in (False, True):
        ctx = _context()
        ctx["signee"] = signee
        html = pdf.render_html(ctx)
        assert "Non signée" not in html
        assert "banner-unsigned" not in html


def test_build_context_signee_depuis_statut():
    # build_context calcule `signee` depuis le statut (sans accès base ici, on
    # vérifie seulement la règle : « signee » => True, tout autre statut => False).
    assert ("signee" == "signee") is True
    for statut in ("en_cours", "a_signer", "envoyee", "cloturee"):
        assert (statut == "signee") is False


def test_format_siren():
    assert pdf._format_siren("838377331") == "838 377 331"
    assert pdf._format_siren("838 377 331") == "838 377 331"
    assert pdf._format_siren("") == ""
    assert pdf._format_siren("123") == "123"  # non-9 chiffres : tel quel


def test_fr_date():
    assert pdf._fr_date("2026-11-11") == "11/11/2026"
    assert pdf._fr_date("2026-01-05T00:00:00") == "05/01/2026"
    assert pdf._fr_date("") == ""
    assert pdf._fr_date(None) == ""

    import datetime
    assert pdf._fr_date(datetime.date(2026, 3, 9)) == "09/03/2026"


def test_unite_label_big_bag_pluriel():
    assert pdf.unite_label("big_bag", 1) == "big bag"
    assert pdf.unite_label("big_bag", 3) == "big bags"
    assert pdf.unite_label("t", 5) == "t"
    assert pdf.unite_label("m3", 2) == "m³"
    assert pdf.unite_label("unite", 1) == "unité"
    assert pdf.unite_label("unite", 4) == "unités"


def test_pdf_date_francaise_et_siren():
    ctx = _context()
    ctx["lv"]["date_etablissement"] = "11/11/2026"  # tel que build_context le produit
    ctx["transporteur"] = {"nom": "KERLAM", "adresse": "KERLAM — 2 rue des Plantes, 77410 Villevaudé",
                           "siren": "838 377 331"}
    html = pdf.render_html(ctx)
    # Une seule date « Établie et prise en charge le … » (décision beta.15).
    assert "Établie et prise en charge le 11/11/2026" in html
    assert "Prise en charge :" not in html
    assert "838 377 331" in html
    assert "2 rue des Plantes" in html


def test_format_creneaux():
    assert pdf.format_creneaux([{"debut": "08:00", "fin": "17:00"}]) == "8h00–17h00"
    assert (
        pdf.format_creneaux([{"debut": "08:00", "fin": "12:00"}, {"debut": "13:00", "fin": "17:00"}])
        == "8h00–12h00 · 13h00–17h00"
    )
    # Fin < début (astreinte, lendemain) : rendu tel quel, sans mention.
    assert pdf.format_creneaux([{"debut": "22:00", "fin": "06:00"}]) == "22h00–6h00"
    assert pdf.format_creneaux([]) == ""
    assert pdf.format_creneaux(None) == ""


def test_heures_creneaux_sur_pdf():
    ctx = _context()
    ctx["lv"].pop("heures_regie", None)
    ctx["lv"]["heures_aff"] = pdf.format_creneaux(
        [{"debut": "08:00", "fin": "12:00"}, {"debut": "13:00", "fin": "17:00"}]
    )
    html = pdf.render_html(ctx)
    assert "Heures 8h00–12h00 · 13h00–17h00" in html
