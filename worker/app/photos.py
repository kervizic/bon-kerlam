"""beta.35 — purge des objets storage des photos de lignes.

Toute suppression d'une photo (par son auteur, ou en cascade : ligne supprimée,
lettre purgée de la corbeille) inscrit ses objets (image + miniature) dans la file
SQL bon.storage_purge (trigger, migration 0033). Ce module :
  1. purge les photos des tours en corbeille depuis plus de 30 jours
     (bon.purge_photos_corbeille) ;
  2. vide la file en supprimant les objets via l'API Storage (service_role).
Idempotent : un objet déjà absent n'est pas une erreur. Un échec réseau laisse la
ligne en file (tentatives comptées) pour le passage suivant.
"""

from __future__ import annotations

import logging

import httpx

from . import db
from .config import settings

log = logging.getLogger("bon.photos")

BATCH = 100
MAX_ATTEMPTS = 20


def _delete_objects(bucket: str, paths: list[str]) -> bool:
    """Suppression groupée (DELETE /object/{bucket}, corps {"prefixes": [...]}).

    Le service Storage expose ses routes SANS le préfixe /storage/v1 (cf. beta.29,
    signature._archive_signed)."""
    r = httpx.request(
        "DELETE",
        f"{settings.storage_url}/object/{bucket}",
        headers={"Authorization": f"Bearer {settings.service_role_key}"},
        json={"prefixes": paths},
        timeout=30,
    )
    if r.status_code < 300 or r.status_code == 404:
        return True
    log.error("purge storage %s : HTTP %s %s", bucket, r.status_code, r.text[:200])
    return False


def process_storage_purge(batch: int = BATCH) -> dict:
    """Vide (par lots) la file bon.storage_purge. Renvoie un récapitulatif."""
    purged_rows = 0
    with_errors = 0
    try:
        row = db.query_one("SELECT bon.purge_photos_corbeille() AS n")
        tours_purges = (row or {}).get("n") or 0
    except Exception as exc:  # noqa: BLE001
        log.error("purge photos corbeille : %r", exc)
        tours_purges = 0
    if not settings.service_role_key:
        log.warning("purge storage ignorée : SERVICE_ROLE_KEY absente")
        return {"photos_tours_corbeille": tours_purges, "objets_supprimes": 0, "erreurs": 0}
    rows = db.query(
        "SELECT id, bucket, path FROM bon.storage_purge WHERE attempts < %s ORDER BY id LIMIT %s",
        (MAX_ATTEMPTS, batch),
    )
    by_bucket: dict[str, list[dict]] = {}
    for r in rows:
        by_bucket.setdefault(r["bucket"], []).append(r)
    for bucket, items in by_bucket.items():
        ids = [i["id"] for i in items]
        try:
            ok = _delete_objects(bucket, [i["path"] for i in items])
            err = None if ok else "HTTP"
        except Exception as exc:  # noqa: BLE001
            ok, err = False, repr(exc)[:200]
        if ok:
            db.query("DELETE FROM bon.storage_purge WHERE id = ANY(%s)", (ids,))
            purged_rows += len(ids)
        else:
            with_errors += len(ids)
            db.query(
                "UPDATE bon.storage_purge SET attempts = attempts + 1, last_error = %s WHERE id = ANY(%s)",
                (err, ids),
            )
    return {"photos_tours_corbeille": tours_purges, "objets_supprimes": purged_rows, "erreurs": with_errors}
