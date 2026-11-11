"""Ordre de la liste de sites, anti-doublon 100 m, rôles chauffeur/bureau."""

from __future__ import annotations

from app import roles, services

from .conftest import (
    add_camion,
    add_chauffeur,
    add_client,
    add_projet,
    add_site,
)


# --- rôles -----------------------------------------------------------------
def test_role_from_groups():
    assert roles.role_from_groups(["bon-bureau"]) == roles.ROLE_BUREAU
    assert roles.role_from_groups(["bon-chauffeur"]) == roles.ROLE_CHAUFFEUR
    # Bureau prime.
    assert roles.role_from_groups(["bon-chauffeur", "bon-bureau"]) == roles.ROLE_BUREAU
    assert roles.role_from_groups(["autre"]) is None
    assert roles.role_from_groups(None) is None


def test_chauffeur_access_own_lv_only():
    assert roles.can_access_lv(roles.ROLE_CHAUFFEUR, 5, 5) is True
    assert roles.can_access_lv(roles.ROLE_CHAUFFEUR, 5, 9) is False
    assert roles.can_access_lv(roles.ROLE_BUREAU, 5, 9) is True


def test_merge_is_bureau_only():
    assert roles.can_merge_referentiel(roles.ROLE_BUREAU) is True
    assert roles.can_merge_referentiel(roles.ROLE_CHAUFFEUR) is False
    # Chauffeur peut créer chantier/article.
    assert roles.can_create_chantier_or_article(roles.ROLE_CHAUFFEUR) is True


# --- anti-doublon ----------------------------------------------------------
def test_duplicate_site_within_100m(conn):
    # Dépôt Claye-Souilly approx.
    add_site(conn, "Dépôt Claye", lat=48.9444, lon=2.6880)
    # Point à ~50 m.
    dup = services.find_duplicate_site(conn, 48.9448, 2.6882)
    assert dup is not None
    assert dup["distance_m"] < 100
    # Point à > 1 km : pas de doublon.
    assert services.find_duplicate_site(conn, 48.9600, 2.7000) is None


# --- ordre de la liste de sites -------------------------------------------
def test_site_list_order(conn):
    cam = add_camion(conn)
    ch = add_chauffeur(conn, camion_id=cam)
    cl = add_client(conn)
    pr = add_projet(conn, cl)

    commun_a = add_site(conn, "Yprema Lagny", famille="commun")
    commun_b = add_site(conn, "Veolia Noisy", famille="commun")
    commun_c = add_site(conn, "Syneos Gournay", famille="commun")  # non utilisé -> bucket commun
    chantier = add_site(conn, "Chantier Gournay", famille="chantier", client_id=cl)
    termine = add_site(conn, "Chantier fini", famille="chantier", client_id=cl, statut="termine")

    # Un tour utilise commun_b (le rend « récent » pour ce chauffeur/client) et
    # augmente sa fréquence.
    lv = services.create_lv(conn, projet_id=pr, client_id=cl, jour="2026-11-11", chauffeur_id=ch)
    tour = services.add_tour(conn, lv, site_chargement_id=commun_b, site_dechargement_id=commun_a)

    ordered = services.site_list(conn, ch, cl)
    buckets = [s["bucket"] for s in ordered]
    ids = [s["id"] for s in ordered]

    # Chantier terminé exclu.
    assert termine not in ids
    # Les récents (commun_a, commun_b utilisés dans le tour) viennent en premier.
    assert buckets[0] == "recent"
    assert set(ids[:2]) == {commun_a, commun_b}
    # Le chantier actif apparaît avant le commun non utilisé.
    assert ids.index(chantier) < ids.index(commun_c)
    assert "chantier" in buckets
    assert "commun" in buckets
    _ = tour
