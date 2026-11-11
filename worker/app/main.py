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
from .auth import require_token
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
    return {"camions": camions, "chauffeurs": chauffeurs}


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
