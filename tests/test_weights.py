"""Calcul de poids et seuils 100 % / 105 % du PTAC."""

from __future__ import annotations

from app import weights
from app.weights import LigneChargement


def test_direct_tonnes():
    est = weights.estimate(6000, [LigneChargement(5, "t")], ptac_kg=15000)
    assert est.masse_totale_t == 11.0
    assert est.gauge == weights.GAUGE_OK
    assert est.poids_partiel is False


def test_m3_with_density():
    est = weights.estimate(6000, [LigneChargement(4, "m3", densite_t_m3=2.0)], ptac_kg=15000)
    # 6 t à vide + 8 t = 14 t
    assert est.masse_totale_t == 14.0


def test_unit_with_unit_weight():
    est = weights.estimate(0, [LigneChargement(10, "unite", poids_unitaire_t=0.5)], ptac_kg=15000)
    assert est.chargement_t == 5.0


def test_line_without_conversion_is_partial_and_uncounted():
    est = weights.estimate(6000, [LigneChargement(4, "m3")], ptac_kg=15000)  # pas de densité
    assert est.poids_partiel is True
    assert est.lignes_non_comptees == 1
    assert est.chargement_t == 0.0


def test_threshold_orange_at_100pct():
    # 15 t pile = 100 % du PTAC 15 t -> orange
    est = weights.estimate(0, [LigneChargement(15, "t")], ptac_kg=15000)
    assert est.ratio == 1.0
    assert est.gauge == weights.GAUGE_WARN


def test_threshold_red_at_105pct():
    est = weights.estimate(0, [LigneChargement(15.75, "t")], ptac_kg=15000)  # 105 %
    assert est.ratio >= 1.05
    assert est.gauge == weights.GAUGE_DANGER


def test_below_100pct_is_ok():
    est = weights.estimate(0, [LigneChargement(14, "t")], ptac_kg=15000)
    assert est.gauge == weights.GAUGE_OK


def test_no_ptac_no_gauge():
    est = weights.estimate(6000, [LigneChargement(5, "t")], ptac_kg=None)
    assert est.ratio is None
    assert est.gauge == weights.GAUGE_OK
