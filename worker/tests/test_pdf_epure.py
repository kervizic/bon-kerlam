"""Maquette « Filet épurée » (beta.23) : libellés de sites « Société · adresse »,
quantités au format français sans zéros inutiles (jamais « 12.000 »), nom du site
au-dessus de l'adresse, absence de la quantité estimée et du cas rattrapage."""

from app import pdf


def _ctx():
    return {
        "transporteur": pdf.TRANSPORTEUR,
        "lv": {
            "numero": "KER-03006",
            "date": "16/11/2026",
            "expediteur": "Veolia\n2 rue de la Plaine, 93160 Noisy-le-Grand",
            "destinataire": "Veolia\n2 rue de la Plaine, 93160 Noisy-le-Grand",
            "camion": "GV-398-JH",
            "chauffeur": "Marc Dubreuil",
            "projet": "Régie Franciliane",
            "heures_aff": "7h00–16h00",
        },
        "prestations": [],
        "tours": [
            {
                "chargement_nom": "Cemex · Ivry béton",
                "chargement_adresse": "12 quai Henri Pourchasse, 94200 Ivry-sur-Seine",
                "dechargement_nom": "Veolia · Noisy",
                "dechargement_adresse": "2 rue de la Plaine, 93160 Noisy-le-Grand",
                "lignes": [
                    {"nom": "Grave 0/31.5", "quantite": 12, "unite": "t",
                     "unite_aff": "t", "quantite_aff": pdf._fmt_qte(12)},
                    {"nom": "Sable", "quantite": 3.5, "unite": "t",
                     "unite_aff": "t", "quantite_aff": pdf._fmt_qte(3.5)},
                ],
            }
        ],
    }


def test_strip_societe_prefix():
    assert pdf.strip_societe_prefix("Veolia – Noisy", "Veolia") == "Noisy"
    assert pdf.strip_societe_prefix("Cemex Ivry béton", "Cemex") == "Ivry béton"
    assert pdf.strip_societe_prefix("RFM - Bondy", "RFM") == "Bondy"
    assert pdf.strip_societe_prefix("YPREMA: Émerainville", "YPREMA") == "Émerainville"
    # Sans préfixe correspondant : inchangé.
    assert pdf.strip_societe_prefix("Dépôt Démo Claye", "Veolia") == "Dépôt Démo Claye"
    # Ne coupe pas un mot qui commence par le nom sans séparateur.
    assert pdf.strip_societe_prefix("Veoliax Site", "Veolia") == "Veoliax Site"


def test_site_label():
    assert pdf.site_label("Cemex Ivry béton", "Cemex") == "Cemex · Ivry béton"
    assert pdf.site_label("Veolia – Noisy", "Veolia") == "Veolia · Noisy"
    # Nom = société seule -> société sans suffixe dupliqué.
    assert pdf.site_label("Veolia", "Veolia") == "Veolia"
    # Sans société : le nom du site tel quel.
    assert pdf.site_label("Dépôt Claye", None) == "Dépôt Claye"
    assert pdf.site_label("Dépôt Claye", "") == "Dépôt Claye"


def test_fmt_qte_pas_de_zeros():
    assert pdf._fmt_qte(12) == "12"
    assert pdf._fmt_qte(12.0) == "12"
    assert pdf._fmt_qte(3.5) == "3,5"
    assert pdf._fmt_qte(1) == "1"


def test_quantites_francaises_sans_zeros():
    html = pdf.render_html(_ctx())
    assert "12 t" in html
    assert "3,5 t" in html
    # Jamais de zéros inutiles ni de point décimal.
    assert "12.000" not in html
    assert "12,000" not in html
    assert ".000" not in html


def test_noms_de_sites_et_adresses():
    html = pdf.render_html(_ctx())
    # Le NOM du site (société · adresse) apparaît, et l'adresse complète aussi.
    assert "Cemex · Ivry béton" in html
    assert "Veolia · Noisy" in html
    assert "12 quai Henri Pourchasse, 94200 Ivry-sur-Seine" in html
    assert "place-name" in html and "place-addr" in html
    # Flèche de la maquette.
    assert "→" in html


def test_pas_de_quantite_estimee_ni_rattrapage():
    html = pdf.render_html(_ctx())
    assert "Quantité estimée de la journée" not in html
    assert "Transport du" not in html   # pas de cas rattrapage
    assert "Établie le" not in html


def test_projet_absent_si_vide():
    ctx = _ctx()
    ctx["lv"]["projet"] = ""
    html = pdf.render_html(ctx)
    assert ">Projet<" not in html
    # Mais présent (libellé « Projet » seul) s'il est renseigné.
    assert ">Projet<" in pdf.render_html(_ctx())


def test_date_sous_le_numero():
    html = pdf.render_html(_ctx())
    assert "Date : 16/11/2026" in html
    assert "Établie et prise en charge le" not in html


def test_aucune_mention_legale_ni_phrase_bas_de_page():
    html = pdf.render_html(_ctx())
    assert "article 4" not in html.lower()
    assert "arrêté" not in html.lower()
    assert "9 novembre 1999" not in html


def test_expediteur_destinataire_une_colonne_si_identiques():
    # same_parties True -> une seule colonne « Expéditeur et destinataire » + Transporteur.
    ctx = _ctx()
    ctx["same_parties"] = True
    html = pdf.render_html(ctx)
    assert "Expéditeur et destinataire" in html
    assert html.count("class=\"party-label\"") == 2  # 1 fusionnée + Transporteur


def test_expediteur_destinataire_trois_colonnes_si_differents():
    ctx = _ctx()
    ctx["same_parties"] = False
    ctx["lv"]["destinataire"] = "Chantier CCPLC\n18 bis Promenade Marx-Dormoy"
    html = pdf.render_html(ctx)
    assert "Expéditeur et destinataire" not in html
    assert html.count("class=\"party-label\"") == 3  # Expéditeur + Destinataire + Transporteur


def test_libelle_heures_seul():
    html = pdf.render_html(_ctx())
    assert ">Heures<" in html
    assert "Heures de régie" not in html


def test_aucun_tableau():
    html = pdf.render_html(_ctx())
    for tag in ("<table", "<th", "<td", "<thead", "<tbody"):
        assert tag not in html
