"""bon-worker — service applicatif de bon.kerlam.fr.

Ce que le navigateur ne peut pas faire : PDF (WeasyPrint), clôture de minuit,
géocodage du seed, API pour l'IA (jetons hachés). OpenAPI sur /worker/docs.
Tout est monté sous le préfixe /worker (nginx proxifie /worker/).
"""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.responses import Response

from . import closing, db, geocode, pdf
from .auth import require_token, require_user
from .config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.geocode_on_start:
        with contextlib.suppress(Exception):
            geocode.geocode_missing()
    task = asyncio.create_task(_midnight_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="bon-worker",
    version=settings.version,
    docs_url="/worker/docs",
    redoc_url=None,
    openapi_url="/worker/openapi.json",
    lifespan=lifespan,
)
router = APIRouter(prefix="/worker")

REFERENTIELS = {
    "camions": "SELECT id, immatriculation, type, ptac_kg, poids_vide_kg, charge_utile_kg, "
    "volume_benne_m3, ct_echeance, chrono_echeance, actif FROM bon.camions ORDER BY immatriculation",
    "chauffeurs": "SELECT id, nom, tel, email, camion_id, fco_echeance, carte_echeance, "
    "nav_app, theme, actif FROM bon.chauffeurs ORDER BY nom",
    "clients": "SELECT id, raison_sociale, adresse, siren, actif FROM bon.clients ORDER BY raison_sociale",
    "projets": "SELECT id, client_id, nom, ref_contrat, ligne_regie, statut FROM bon.projets ORDER BY id DESC",
    "sites": "SELECT id, nom, adresse, lat, lon, type, portee, client_id, statut FROM bon.sites ORDER BY nom",
    "articles": "SELECT id, nom, commentaire_interne, unites, densite_t_m3, poids_unitaire_t, actif "
    "FROM bon.articles ORDER BY nom",
}


@router.get("/version")
def version() -> dict:
    return {
        "version": settings.version,
        "sha": settings.git_sha,
        "schema_version": db.schema_version(),
    }


@router.get("/healthz")
@router.get("/health")
def healthz() -> dict:
    return {"status": "ok"}


@router.get("/lv")
def lv_list(query: str = "", date: str = "", statut: str = "", _=Depends(require_token("read"))):
    sql = [
        "SELECT lv.id, lv.numero, lv.date_etablissement, lv.statut, lv.expediteur, "
        "lv.destinataire, p.nom AS projet, ch.nom AS chauffeur "
        "FROM bon.lettres_voiture lv "
        "LEFT JOIN bon.projets p ON p.id = lv.projet_id "
        "LEFT JOIN bon.chauffeurs ch ON ch.id = lv.chauffeur_id "
        "WHERE lv.deleted_at IS NULL"
    ]
    params: list = []
    if query:
        sql.append("AND (lv.numero ILIKE %s OR lv.expediteur ILIKE %s OR lv.destinataire ILIKE %s)")
        params += [f"%{query}%"] * 3
    if date:
        sql.append("AND lv.date_etablissement = %s")
        params.append(date)
    if statut:
        sql.append("AND lv.statut = %s")
        params.append(statut)
    sql.append("ORDER BY lv.date_etablissement DESC, lv.id DESC LIMIT 200")
    return db.query(" ".join(sql), tuple(params))


@router.get("/lv/{lv_id}")
def lv_get(lv_id: int, _=Depends(require_token("read"))):
    try:
        ctx = pdf.build_context(lv_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ctx


@router.get("/alertes")
def alertes(_=Depends(require_token("read"))):
    camions = db.query(
        "SELECT id, immatriculation, ct_echeance, chrono_echeance FROM bon.camions "
        "WHERE actif AND (ct_echeance <= CURRENT_DATE + 60 OR chrono_echeance <= CURRENT_DATE + 60)"
    )
    chauffeurs = db.query(
        "SELECT id, nom, fco_echeance, carte_echeance FROM bon.chauffeurs "
        "WHERE actif AND (fco_echeance <= CURRENT_DATE + 60 OR carte_echeance <= CURRENT_DATE + 60)"
    )
    # Documents réglementaires (permis, FCO, carte conducteur, CACES). Le worker
    # (bon_worker, BYPASSRLS) appelle la fonction métier directement.
    documents = db.query("SELECT * FROM bon.alertes_documents()")
    return {"camions": camions, "chauffeurs": chauffeurs, "documents": documents}


@router.post("/signature/envoi-groupe")
def signature_envoi_groupe(payload: dict | None = None, _=Depends(require_token("write"))):
    """Point d'extension signature groupée. Déclenché UNIQUEMENT par un bouton
    (chauffeur ou bureau), jamais automatiquement. L'envoi Documenso lui-même est
    hors périmètre de cette beta : on liste seulement les LV visées."""
    lv_ids = (payload or {}).get("lv_ids") or []
    rows = db.query(
        "SELECT id, numero, statut FROM bon.lettres_voiture "
        "WHERE id = ANY(%s) AND deleted_at IS NULL",
        (list(lv_ids),),
    )
    return {
        "declenche_par": "bouton",
        "auto": False,
        "documenso": "hors_perimetre_beta",
        "lv": rows,
    }


@router.post("/chauffeur/{chauffeur_id}/depart")
def chauffeur_depart(chauffeur_id: int, _=Depends(require_token("write"))):
    """Départ d'un salarié : purge les scans de documents (base + Storage)."""
    rows = db.query("SELECT bon.purge_documents_chauffeur(%s) AS keys", (chauffeur_id,))
    keys = rows[0]["keys"] if rows else []
    deleted = _delete_storage_objects(keys)
    db.query(
        "UPDATE bon.chauffeurs SET date_sortie = COALESCE(date_sortie, CURRENT_DATE) WHERE id = %s",
        (chauffeur_id,),
    )
    return {"purges": keys, "storage_supprimes": deleted}


@router.get("/document/signed-url")
def document_signed_url(key: str, expires: int = 120, _=Depends(require_token("read"))):
    """URL signée courte (par défaut 120 s) vers un scan du bucket privé."""
    if not settings.service_role_key:
        raise HTTPException(status_code=501, detail="SERVICE_ROLE_KEY non configurée.")
    import httpx

    path = key.split("/", 1)[1] if key.startswith(settings.docs_bucket + "/") else key
    url = f"{settings.storage_url}/storage/v1/object/sign/{settings.docs_bucket}/{path}"
    try:
        r = httpx.post(
            url,
            headers={"Authorization": f"Bearer {settings.service_role_key}"},
            json={"expiresIn": expires},
            timeout=10,
        )
        r.raise_for_status()
        signed = r.json().get("signedURL") or r.json().get("signedUrl")
        return {"signed_url": f"{settings.storage_url}/storage/v1{signed}" if signed else None}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Storage: {exc}") from exc


def _delete_storage_objects(keys: list[str]) -> int:
    if not keys or not settings.service_role_key:
        return 0
    import httpx

    deleted = 0
    for key in keys:
        path = key.split("/", 1)[1] if key.startswith(settings.docs_bucket + "/") else key
        try:
            r = httpx.delete(
                f"{settings.storage_url}/storage/v1/object/{settings.docs_bucket}/{path}",
                headers={"Authorization": f"Bearer {settings.service_role_key}"},
                timeout=10,
            )
            if r.status_code < 300:
                deleted += 1
        except Exception:  # noqa: BLE001
            pass
    return deleted


@router.get("/referentiel/{kind}")
def referentiel(kind: str, _=Depends(require_token("read"))):
    sql = REFERENTIELS.get(kind)
    if sql is None:
        raise HTTPException(status_code=404, detail=f"Référentiel inconnu: {kind}")
    return db.query(sql)


@router.post("/pdf/{lv_id}")
def lv_pdf(lv_id: int, _=Depends(require_token("read"))):
    try:
        ctx = pdf.build_context(lv_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=pdf.render_pdf(ctx), media_type="application/pdf")


def _user_can_access_lv(email: str | None, lv_id: int) -> bool:
    """Le bureau voit toutes les lettres ; un chauffeur, seulement les siennes.

    bon_worker a le BYPASSRLS : on applique donc la règle d'accès explicitement
    ici (même logique que la RLS des schémas api/bon)."""
    if not email:
        return False
    row = db.query_one(
        """
        SELECT (
          EXISTS (
            SELECT 1 FROM bon.utilisateurs u
             WHERE lower(u.email) = lower(%(email)s) AND 'bureau' = ANY(u.roles)
          )
          OR EXISTS (
            SELECT 1 FROM bon.lettres_voiture lv
              LEFT JOIN bon.chauffeurs ch ON ch.id = lv.chauffeur_id
             WHERE lv.id = %(id)s AND lv.deleted_at IS NULL
               AND (lower(lv.owner_email) = lower(%(email)s)
                    OR lower(ch.email) = lower(%(email)s))
          )
        ) AS allowed
        """,
        {"email": email, "id": lv_id},
    )
    return bool(row and row["allowed"])


@router.post("/lv/{lv_id}/pdf")
def lv_pdf_user(lv_id: int, user=Depends(require_user)):
    """PDF officiel pour l'utilisateur connecté (jeton de session Supabase).

    Permet au front PWA de générer/partager le PDF sans jeton IA. Le bandeau
    « Non signée » est géré par le gabarit selon le statut de la lettre."""
    if not _user_can_access_lv(user.get("email"), lv_id):
        raise HTTPException(status_code=403, detail="Accès refusé à cette lettre de voiture.")
    try:
        ctx = pdf.build_context(lv_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=pdf.render_pdf(ctx), media_type="application/pdf")


@router.post("/close-midnight")
def close_midnight(_=Depends(require_token("write"))):
    return {"closed": closing.close_overdue()}


@router.post("/geocode")
def run_geocode(_=Depends(require_token("write"))):
    return {"updated": geocode.geocode_missing()}


app.include_router(router)


async def _midnight_loop() -> None:
    while True:
        now = datetime.now()
        nxt = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
        await asyncio.sleep(max((nxt - now).total_seconds(), 60))
        with contextlib.suppress(Exception):
            closing.close_overdue()
