"""Estimation de la masse totale et comparaison au PTAC.

Règles (simple affichage, aucun blocage) :
- masse totale estimée = poids à vide + somme des conversions des lignes.
- conversion d'une ligne de chargement en tonnes :
    * unité `t`    -> quantité directe.
    * unité `m3`   -> quantité × densité (t/m³) de l'article, si définie.
    * unité `unite`-> quantité × poids unitaire (t), si défini.
    * sinon        -> non convertible : la ligne n'est PAS comptée et la jauge
                      est marquée « poids partiel ».
- seuils vs PTAC : ratio >= 1.00 => orange, >= 1.05 => rouge, sinon vert.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Statuts de la jauge
GAUGE_OK = "ok"          # vert
GAUGE_WARN = "warn"      # orange  (>= 100 %)
GAUGE_DANGER = "danger"  # rouge   (>= 105 %)

ORANGE_THRESHOLD = 1.00
RED_THRESHOLD = 1.05


@dataclass(frozen=True)
class LigneChargement:
    quantite: float
    unite: str
    densite_t_m3: float | None = None
    poids_unitaire_t: float | None = None


@dataclass
class WeightEstimate:
    poids_vide_t: float
    chargement_t: float
    masse_totale_t: float
    ptac_t: float | None
    ratio: float | None
    gauge: str
    poids_partiel: bool
    lignes_non_comptees: int = 0
    _notes: list[str] = field(default_factory=list)


def _ligne_en_tonnes(ligne: LigneChargement) -> float | None:
    unite = (ligne.unite or "").strip().lower()
    if unite in {"t", "tonne", "tonnes"}:
        return float(ligne.quantite)
    if unite in {"m3", "m³"}:
        if ligne.densite_t_m3 is not None:
            return float(ligne.quantite) * float(ligne.densite_t_m3)
        return None
    if unite in {"u", "unite", "unité", "unites", "unités"}:
        if ligne.poids_unitaire_t is not None:
            return float(ligne.quantite) * float(ligne.poids_unitaire_t)
        return None
    return None


def estimate(
    poids_vide_kg: float | None,
    lignes: list[LigneChargement],
    ptac_kg: float | None = None,
) -> WeightEstimate:
    poids_vide_t = (poids_vide_kg or 0) / 1000.0
    chargement_t = 0.0
    partiel = False
    non_comptees = 0

    for ligne in lignes:
        valeur = _ligne_en_tonnes(ligne)
        if valeur is None:
            partiel = True
            non_comptees += 1
            continue
        chargement_t += valeur

    masse_totale_t = poids_vide_t + chargement_t
    ptac_t = (ptac_kg / 1000.0) if ptac_kg else None

    ratio: float | None = None
    gauge = GAUGE_OK
    if ptac_t and ptac_t > 0:
        ratio = masse_totale_t / ptac_t
        if ratio >= RED_THRESHOLD:
            gauge = GAUGE_DANGER
        elif ratio >= ORANGE_THRESHOLD:
            gauge = GAUGE_WARN

    return WeightEstimate(
        poids_vide_t=round(poids_vide_t, 3),
        chargement_t=round(chargement_t, 3),
        masse_totale_t=round(masse_totale_t, 3),
        ptac_t=round(ptac_t, 3) if ptac_t else None,
        ratio=round(ratio, 4) if ratio is not None else None,
        gauge=gauge,
        poids_partiel=partiel,
        lignes_non_comptees=non_comptees,
    )
