"""Routeur API v1 : référentiels, lettres de voiture, tours, PDF, jetons.

Tout ce qui est affiché par l'interface passe par cette API (aucun écran n'a de
donnée hors API).
"""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from .. import auth, pdf, services, weights
from ..config import Settings
from .deps import get_conn, require_bureau, require_principal, require_write

router = APIRouter(prefix="/api/v1", tags=["v1"])

# Tables de référentiel exposées en lecture/création générique.
REFERENTIELS: dict[str, tuple[str, ...]] = {
    "camions": ("immatriculation", "type", "ptac_kg", "poids_vide_kg", "volume_benne_m3",
                "ct_echeance", "chrono_echeance", "actif"),
    "chauffeurs": ("nom", "tel", "email", "camion_id", "fco_echeance",
                   "carte_conducteur_echeance", "nav_app", "nav_app_autre", "actif",
                   "oidc_sub", "oidc_email"),
    "clients": ("raison_sociale", "adresse", "siren"),
    "contacts": ("client_id", "nom", "tel", "email", "fonction", "signataire"),
    "projets": ("client_id", "ref_contrat", "ref_ordre_mission", "ligne_regie", "tarif",
                "contact_defaut_id", "date_debut", "date_fin", "statut"),
    "sites": ("nom", "adresse", "lat", "lon", "type_site", "famille", "client_id",
              "statut", "derniere_utilisation", "created_by_chauffeur_id"),
    "articles": ("nom", "unites", "densite_t_m3", "poids_unitaire_t", "created_by_chauffeur_id"),
}


def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


# ---------------------------------------------------------------------------
# Lettres de voiture
# ---------------------------------------------------------------------------
class LvCreate(BaseModel):
    projet_id: int
    client_id: int
    jour: str
    chauffeur_id: int | None = None
    camion_id: int | None = None
    date_etablissement: str | None = None
    expediteur: str | None = None
    destinataire: str | None = None
    prepared_by_bureau: bool = False
    heure_debut_regie: str | None = None
    heure_fin_regie: str | None = None


class TourCreate(BaseModel):
    heure_depart: str | None = None
    gps_lat: float | None = None
    gps_lon: float | None = None
    site_chargement_id: int | None = None
    site_dechargement_id: int | None = None


class LigneCreate(BaseModel):
    article_id: int
    quantite: float
    unite: str
    chauffeur_id: int | None = None


class DuplicateCheck(BaseModel):
    lat: float
    lon: float
    radius_m: float = 100.0


@router.post("/lettres", status_code=status.HTTP_201_CREATED, summary="Créer une LV")
def create_lv(
    body: LvCreate,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_write),
) -> dict[str, Any]:
    lv_id = services.create_lv(conn, **body.model_dump())
    return services.get_lv(conn, lv_id)


@router.get("/lettres", summary="Lister les LV")
def list_lv(
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
) -> list[dict[str, Any]]:
    if principal.role == "chauffeur" and principal.chauffeur_id is not None:
        return _rows(
            conn,
            "SELECT * FROM lettres_voiture WHERE deleted_at IS NULL AND chauffeur_id = ? ORDER BY id DESC",
            (principal.chauffeur_id,),
        )
    return _rows(conn, "SELECT * FROM lettres_voiture WHERE deleted_at IS NULL ORDER BY id DESC")


@router.get("/lettres/{lv_id}", summary="Lire une LV")
def get_lv(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
) -> dict[str, Any]:
    lv = services.get_lv(conn, lv_id)
    if lv is None or lv["deleted_at"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "LV introuvable")
    return lv


@router.post("/lettres/{lv_id}/tours", status_code=status.HTTP_201_CREATED, summary="Ajouter un tour")
def add_tour(
    lv_id: int,
    body: TourCreate,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_write),
) -> dict[str, Any]:
    try:
        res = services.add_tour(conn, lv_id, **body.model_dump())
    except PermissionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    services.record_action(
        conn, lv_id, actor_key=principal.actor_key, actor_label=principal.label,
        kind="add_tour", via_ia=principal.via_ia,
    )
    return res


@router.post("/tours/{tour_id}/lignes", status_code=status.HTTP_201_CREATED, summary="Ajouter une ligne")
def add_ligne(
    tour_id: int,
    body: LigneCreate,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_write),
) -> dict[str, Any]:
    ligne_id = services.add_tour_ligne(conn, tour_id, **body.model_dump())
    return {"id": ligne_id}


@router.get("/lettres/{lv_id}/poids", summary="Masse estimée vs PTAC")
def lv_poids(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
) -> dict[str, Any]:
    lv = services.get_lv(conn, lv_id)
    if lv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "LV introuvable")
    cam = conn.execute("SELECT * FROM camions WHERE id = ?", (lv["camion_id"],)).fetchone()
    lignes = conn.execute(
        """
        SELECT tl.quantite, tl.unite, a.densite_t_m3, a.poids_unitaire_t
        FROM tour_lignes tl
        JOIN tours t ON t.id = tl.tour_id
        JOIN articles a ON a.id = tl.article_id
        WHERE t.lv_id = ? AND tl.deleted_at IS NULL AND t.deleted_at IS NULL
        """,
        (lv_id,),
    ).fetchall()
    charge = [
        weights.LigneChargement(r["quantite"], r["unite"], r["densite_t_m3"], r["poids_unitaire_t"])
        for r in lignes
    ]
    est = weights.estimate(
        cam["poids_vide_kg"] if cam else None, charge, ptac_kg=cam["ptac_kg"] if cam else None
    )
    return est.__dict__ | {"_notes": None}


@router.post("/lettres/{lv_id}/sign", summary="Signer (figer) une LV")
def sign_lv(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_bureau),
) -> dict[str, str]:
    services.sign_lv(conn, lv_id, actor_key=principal.actor_key, actor_label=principal.label)
    return {"statut": "signee"}


@router.post("/lettres/{lv_id}/undo", summary="Annuler sa dernière action")
def undo(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_write),
) -> dict[str, Any]:
    res = services.undo(conn, lv_id, principal.actor_key)
    return {"undone": res}


@router.post("/lettres/{lv_id}/redo", summary="Refaire sa dernière action")
def redo(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_write),
) -> dict[str, Any]:
    res = services.redo(conn, lv_id, principal.actor_key)
    return {"redone": res}


@router.get("/lettres/{lv_id}/historique", summary="Historique complet d'une LV")
def historique(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
) -> list[dict[str, Any]]:
    return _rows(conn, "SELECT * FROM lv_actions WHERE lv_id = ? ORDER BY id", (lv_id,))


# ---------------------------------------------------------------------------
# Pré-remplissage, sites, anti-doublon
# ---------------------------------------------------------------------------
@router.get("/prefill", summary="Valeurs par défaut d'un nouveau bon")
def prefill(
    chauffeur_id: int,
    jour: str,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
) -> dict[str, Any]:
    return services.prefill_new_lv(conn, chauffeur_id, jour)


@router.get("/sites-liste", summary="Liste ordonnée des sites")
def sites_liste(
    chauffeur_id: int,
    client_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
) -> list[dict[str, Any]]:
    return services.site_list(conn, chauffeur_id, client_id)


@router.post("/sites-doublon", summary="Chercher un site existant à proximité")
def sites_doublon(
    body: DuplicateCheck,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
) -> dict[str, Any]:
    dup = services.find_duplicate_site(conn, body.lat, body.lon, radius_m=body.radius_m)
    return {"doublon": dup}


# ---------------------------------------------------------------------------
# PDF de la LV
# ---------------------------------------------------------------------------
def _pdf_context(conn: sqlite3.Connection, settings: Settings, lv_id: int) -> dict[str, Any]:
    lv = services.get_lv(conn, lv_id)
    if lv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "LV introuvable")
    cam = conn.execute("SELECT * FROM camions WHERE id = ?", (lv["camion_id"],)).fetchone()
    ch = conn.execute("SELECT * FROM chauffeurs WHERE id = ?", (lv["chauffeur_id"],)).fetchone()
    pr = conn.execute("SELECT * FROM projets WHERE id = ?", (lv["projet_id"],)).fetchone()
    tours_rows = conn.execute(
        "SELECT * FROM tours WHERE lv_id = ? AND deleted_at IS NULL ORDER BY ordre", (lv_id,)
    ).fetchall()
    tours = []
    for t in tours_rows:
        charg = conn.execute("SELECT adresse FROM sites WHERE id = ?", (t["site_chargement_id"],)).fetchone()
        dech = conn.execute("SELECT adresse FROM sites WHERE id = ?", (t["site_dechargement_id"],)).fetchone()
        lignes = conn.execute(
            "SELECT a.nom AS article, tl.quantite, tl.unite FROM tour_lignes tl "
            "JOIN articles a ON a.id = tl.article_id WHERE tl.tour_id = ? AND tl.deleted_at IS NULL",
            (t["id"],),
        ).fetchall()
        tours.append({
            "ordre": t["ordre"], "heure_depart": t["heure_depart"],
            "chargement_adresse": charg["adresse"] if charg else None,
            "dechargement_adresse": dech["adresse"] if dech else None,
            "lignes": [dict(x) for x in lignes],
        })
    # Destinataire identique à l'expéditeur : nom écrit en entier, jamais « idem ».
    destinataire_affiche = lv["destinataire"]
    if lv["dest_identique_exp"] and not destinataire_affiche:
        destinataire_affiche = lv["expediteur"]
    poids = lv_poids_internal(conn, lv_id, cam)
    return {
        "lv": lv, "camion": dict(cam) if cam else None, "chauffeur": dict(ch) if ch else None,
        "projet": dict(pr) if pr else {}, "tours": tours,
        "destinataire_affiche": destinataire_affiche,
        "carrier": {"name": settings.carrier_name, "address": settings.carrier_address,
                    "siren": settings.carrier_siren},
        "app": {"name": "bon.kerlam.fr", "version": settings.app_version},
        "masse_totale_t": poids.masse_totale_t, "ptac_t": poids.ptac_t,
    }


def lv_poids_internal(conn, lv_id, cam):
    lignes = conn.execute(
        "SELECT tl.quantite, tl.unite, a.densite_t_m3, a.poids_unitaire_t FROM tour_lignes tl "
        "JOIN tours t ON t.id = tl.tour_id JOIN articles a ON a.id = tl.article_id "
        "WHERE t.lv_id = ? AND tl.deleted_at IS NULL AND t.deleted_at IS NULL",
        (lv_id,),
    ).fetchall()
    charge = [weights.LigneChargement(r["quantite"], r["unite"], r["densite_t_m3"], r["poids_unitaire_t"])
              for r in lignes]
    return weights.estimate(cam["poids_vide_kg"] if cam else None, charge,
                            ptac_kg=cam["ptac_kg"] if cam else None)


@router.get("/lettres/{lv_id}/pdf", summary="PDF A4 de la LV")
def lv_pdf(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
):
    from ..config import get_settings
    ctx = _pdf_context(conn, get_settings(), lv_id)
    try:
        data = pdf.render_pdf(ctx)
    except pdf.PdfUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"PDF indisponible: {exc}") from exc
    numero = ctx["lv"]["numero"] or f"lv-{lv_id}"
    return Response(
        content=data, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{numero}.pdf"'},
    )


@router.get("/lettres/{lv_id}/apercu.html", summary="Aperçu HTML (mode contrôle)")
def lv_html(
    lv_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_principal),
):
    from ..config import get_settings
    ctx = _pdf_context(conn, get_settings(), lv_id)
    return Response(content=pdf.render_html(ctx), media_type="text/html")


# ---------------------------------------------------------------------------
# Jetons d'API (bureau)
# ---------------------------------------------------------------------------
class TokenCreate(BaseModel):
    nom: str = Field(min_length=1)
    scope: str = "read"
    is_ia: bool = True


@router.post("/tokens", status_code=status.HTTP_201_CREATED, summary="Créer un jeton d'API")
def create_token(
    body: TokenCreate,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_bureau),
) -> dict[str, str]:
    token = auth.create_api_token(conn, body.nom, scope=body.scope, is_ia=body.is_ia)
    return {"token": token, "note": "Conservez ce jeton : il ne sera plus affiché."}


@router.delete("/tokens/{token_id}", summary="Révoquer un jeton")
def revoke_token(
    token_id: int,
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_bureau),
) -> dict[str, bool]:
    conn.execute("UPDATE api_tokens SET revoked = 1 WHERE id = ?", (token_id,))
    conn.commit()
    return {"revoked": True}


# ---------------------------------------------------------------------------
# Référentiels génériques — déclarés EN DERNIER pour ne pas masquer les routes
# spécifiques (/lettres, /tokens, /prefill, ...).
# ---------------------------------------------------------------------------
@router.get("/{table}", summary="Lister un référentiel")
def list_referentiel(
    table: str,
    conn: sqlite3.Connection = Depends(get_conn),
    _p: auth.Principal = Depends(require_principal),
) -> list[dict[str, Any]]:
    if table not in REFERENTIELS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Référentiel inconnu")
    return _rows(conn, f"SELECT * FROM {table} WHERE deleted_at IS NULL ORDER BY id DESC")


@router.post("/{table}", status_code=status.HTTP_201_CREATED, summary="Créer dans un référentiel")
def create_referentiel(
    table: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection = Depends(get_conn),
    principal: auth.Principal = Depends(require_write),
) -> dict[str, Any]:
    if table not in REFERENTIELS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Référentiel inconnu")
    cols = [c for c in REFERENTIELS[table] if c in payload]
    if not cols:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Aucun champ valide")
    placeholders = ", ".join("?" for _ in cols)
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})"
    cur = conn.execute(sql, tuple(payload[c] for c in cols))
    conn.commit()
    return dict(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (cur.lastrowid,)).fetchone())
