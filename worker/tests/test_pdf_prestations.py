"""Bloc « Prestations » du PDF : pluriels d'unité (jour/heure), rendu du tableau
placé avant le récapitulatif des tours, et absence du bloc si aucune prestation."""

from app import pdf


def _context(prestations):
    return {
        "transporteur": pdf.TRANSPORTEUR,
        "lv": {
            "numero": "KER-03000",
            "date_etablissement": "11/11/2026",
            "date_prise_en_charge": "11/11/2026",
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
                "lignes": [{"nom": "Grave", "quantite": 12, "unite": "t"}],
            }
        ],
        "prestations": prestations,
    }


def test_unite_label_jour_heure_pluriel():
    assert pdf.unite_label("jour", 1) == "jour"
    assert pdf.unite_label("jour", 2) == "jours"
    assert pdf.unite_label("heure", 1) == "heure"
    assert pdf.unite_label("heure", 3) == "heures"


def test_prestations_bloc_present_et_place_avant_tours():
    prestations = [
        {
            "libelle": "Location mini-pelle",
            "quantite": 2,
            "unite": "jour",
            "unite_aff": pdf.unite_label("jour", 2),
            "materiel": "Kubota U17",
        }
    ]
    html = pdf.render_html(_context(prestations))
    # Le bloc et son contenu apparaissent.
    assert "Prestations" in html
    assert "Location mini-pelle" in html
    assert "Kubota U17" in html
    assert "jours" in html  # unité accordée au pluriel
    # Placement : le bloc Prestations précède le récapitulatif des tours.
    assert html.index("Prestations") < html.index("État récapitulatif des tours")


def test_prestations_commentaire_interne_absent():
    secret = "SECRET-PRESTA-NE-PAS-IMPRIMER-42"
    prestations = [
        {
            "libelle": "Nettoyage chantier",
            "quantite": 1,
            "unite": "heure",
            "unite_aff": pdf.unite_label("heure", 1),
            "materiel": None,
            "commentaire_interne": secret,
        }
    ]
    html = pdf.render_html(_context(prestations))
    assert "Nettoyage chantier" in html
    assert "heure" in html
    assert "—" in html  # matériel absent => tiret
    assert secret not in html


def test_prestations_vides_pas_de_bloc():
    html = pdf.render_html(_context([]))
    # Sans prestation, le titre « Prestations » ne doit pas apparaître.
    assert "Prestations" not in html
    assert "État récapitulatif des tours" in html
