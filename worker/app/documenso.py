"""Client Documenso (API v1, sign.kerlam.fr) — signature électronique.

La clé API est lue dans l'environnement du worker (DOCUMENSO_API_KEY) et n'est
JAMAIS journalisée, renvoyée au front, ni stockée en base. Flux v1 :
  1. POST /documents            -> { documentId, uploadUrl, recipients:[{recipientId, token}] }
  2. PUT  uploadUrl (PDF)       (URL présignée S3)
  3. POST /documents/{id}/fields  (champ SIGNATURE pour le signataire)
  4. POST /documents/{id}/send    (sendEmail true = mail au contact ; false = lien)
L'URL de signature « sur place » = {documenso_url}/sign/{token}.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import httpx

from .config import settings


class DocumensoError(RuntimeError):
    pass


def _headers() -> dict:
    if not settings.documenso_api_key:
        raise DocumensoError("DOCUMENSO_API_KEY non configurée côté worker.")
    return {"Authorization": settings.documenso_api_key}


def _base() -> str:
    return settings.documenso_url.rstrip("/") + "/api/v1"


def create_document(
    title: str,
    signer_name: str,
    signer_email: str,
    pdf_bytes: bytes,
    *,
    send_email: bool,
    subject: str = "",
    message: str = "",
    sign_page: int = 1,
    fields: list[dict] | None = None,
) -> dict:
    """Crée un document Documenso, téléverse le PDF, place les champs (signature +
    nom, un par lettre) et l'envoie. Renvoie { document_id, token, signing_url }.

    `fields` : géométrie en % de page (type, pageNumber, pageX/Y/Width/Height),
    sans recipientId (injecté ici). À défaut, un unique champ SIGNATURE sur
    `sign_page` (compat)."""
    body = {
        "title": title,
        "recipients": [{"name": signer_name or signer_email, "email": signer_email, "role": "SIGNER"}],
    }
    if subject or message:
        body["meta"] = {"subject": subject, "message": message}

    # Connexion HTTP réutilisée (keep-alive) pour toutes les étapes -> moins de
    # latence (pas de nouvelle poignée de main TLS par appel).
    with httpx.Client(headers=_headers(), timeout=60) as client:
        r = client.post(f"{_base()}/documents", json=body)
        if r.status_code >= 300:
            raise DocumensoError(f"création document: {r.status_code} {r.text[:200]}")
        data = r.json()
        document_id = data["documentId"]
        recipient_id = data["recipients"][0]["recipientId"]
        token = data["recipients"][0].get("token")

        up = client.put(data["uploadUrl"], content=pdf_bytes, headers={"Content-Type": "application/pdf"})
        if up.status_code >= 300:
            raise DocumensoError(f"téléversement PDF: {up.status_code}")

        # Champs (coordonnées en % de page). Par défaut : un champ SIGNATURE (compat).
        if fields is None:
            fields = [{"type": "SIGNATURE", "pageNumber": sign_page,
                       "pageX": 8, "pageY": 78, "pageWidth": 36, "pageHeight": 12}]

        # Création EN PARALLÈLE (1 appel par champ, mais simultanés) : 10 champs en
        # ~1 aller-retour au lieu de 10.
        def _post_field(geom: dict):
            fr = client.post(f"{_base()}/documents/{document_id}/fields", json={"recipientId": recipient_id, **geom})
            if fr.status_code >= 300:
                raise DocumensoError(f"champ {geom.get('type')}: {fr.status_code} {fr.text[:150]}")

        if len(fields) > 1:
            with ThreadPoolExecutor(max_workers=min(10, len(fields))) as pool:
                for _ in pool.map(_post_field, fields):
                    pass
        else:
            _post_field(fields[0])

        sr = client.post(f"{_base()}/documents/{document_id}/send", json={"sendEmail": bool(send_email)})
        if sr.status_code >= 300:
            raise DocumensoError(f"envoi: {sr.status_code} {sr.text[:200]}")

    signing_url = f"{settings.documenso_url.rstrip('/')}/sign/{token}" if token else None
    return {"document_id": document_id, "token": token, "signing_url": signing_url}


def list_documents(per_page: int = 100) -> list[dict]:
    """Liste des documents (pour la purge des brouillons abandonnés)."""
    r = httpx.get(f"{_base()}/documents", headers=_headers(), params={"perPage": per_page}, timeout=30)
    if r.status_code >= 300:
        raise DocumensoError(f"liste documents: {r.status_code}")
    return r.json().get("documents", [])


def document_status(document_id: int) -> dict:
    r = httpx.get(f"{_base()}/documents/{document_id}", headers=_headers(), timeout=30)
    if r.status_code >= 300:
        raise DocumensoError(f"statut document: {r.status_code}")
    return r.json()


def is_completed(document_id: int) -> bool:
    return str(document_status(document_id).get("status", "")).upper() == "COMPLETED"


def download_signed(document_id: int) -> bytes | None:
    r = httpx.get(f"{_base()}/documents/{document_id}/download", headers=_headers(), timeout=30)
    if r.status_code >= 300:
        return None
    url = r.json().get("downloadUrl")
    if not url:
        return None
    d = httpx.get(url, timeout=60)
    if d.status_code >= 300:
        return None
    return d.content


def delete_document(document_id: int) -> bool:
    """Supprime/annule un document (utilisé pour retirer le test de signature)."""
    r = httpx.delete(f"{_base()}/documents/{document_id}", headers=_headers(), timeout=30)
    return r.status_code < 300
