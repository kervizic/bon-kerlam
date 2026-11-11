"""Rôles et autorisations, déduits du claim OIDC `groups`."""

from __future__ import annotations

ROLE_BUREAU = "bureau"
ROLE_CHAUFFEUR = "chauffeur"


def role_from_groups(
    groups: list[str] | None,
    *,
    group_bureau: str = "bon-bureau",
    group_chauffeur: str = "bon-chauffeur",
) -> str | None:
    """Le bureau prime sur le chauffeur si les deux groupes sont présents."""
    groups = groups or []
    if group_bureau in groups:
        return ROLE_BUREAU
    if group_chauffeur in groups:
        return ROLE_CHAUFFEUR
    return None


def can_access_lv(role: str, user_chauffeur_id: int | None, lv_chauffeur_id: int | None) -> bool:
    """Le bureau voit tout ; le chauffeur ne voit que ses propres LV."""
    if role == ROLE_BUREAU:
        return True
    if role == ROLE_CHAUFFEUR:
        return user_chauffeur_id is not None and user_chauffeur_id == lv_chauffeur_id
    return False


def can_create_chantier_or_article(role: str) -> bool:
    """Chauffeur comme bureau peuvent créer un chantier / un article."""
    return role in {ROLE_BUREAU, ROLE_CHAUFFEUR}


def can_merge_referentiel(role: str) -> bool:
    """Seul le bureau fusionne les doublons (sites, articles)."""
    return role == ROLE_BUREAU


def can_restore_version(role: str) -> bool:
    return role == ROLE_BUREAU


def can_manage_planning(role: str) -> bool:
    return role == ROLE_BUREAU
