"""Calculs géographiques (anti-doublon de sites à moins de 100 m)."""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance en mètres entre deux points GPS (formule de haversine)."""
    rlat1, rlat2 = radians(lat1), radians(lat2)
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))


def is_duplicate(lat1: float, lon1: float, lat2: float, lon2: float, radius_m: float = 100.0) -> bool:
    """Vrai si les deux points sont à moins de `radius_m` (doublon de site probable)."""
    return haversine_m(lat1, lon1, lat2, lon2) < radius_m
