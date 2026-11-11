"""Géocodage des sites sans coordonnées via la Base Adresse Nationale (BAN).

Appelé au premier démarrage (GEOCODE_ON_START=true) ou à la demande. Le chauffeur
vérifie toujours la position ; le bureau peut déplacer l'épingle.
"""

from __future__ import annotations

import httpx

from . import db
from .config import settings


def geocode_one(adresse: str) -> tuple[float, float] | None:
    try:
        r = httpx.get(settings.ban_url, params={"q": adresse, "limit": 1}, timeout=10)
        r.raise_for_status()
        feats = r.json().get("features") or []
        if not feats:
            return None
        lon, lat = feats[0]["geometry"]["coordinates"]
        return float(lat), float(lon)
    except Exception:
        return None


def geocode_missing() -> int:
    """Complète lat/lon des sites qui en manquent. Renvoie le nombre mis à jour."""
    sites = db.query(
        "SELECT id, adresse FROM bon.sites "
        "WHERE (lat IS NULL OR lon IS NULL) AND adresse IS NOT NULL"
    )
    done = 0
    for site in sites:
        coords = geocode_one(site["adresse"])
        if coords is None:
            continue
        db.query(
            "UPDATE bon.sites SET lat = %s, lon = %s WHERE id = %s",
            (coords[0], coords[1], site["id"]),
        )
        done += 1
    return done
