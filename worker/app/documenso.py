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
) -> dict:
    """Crée un document Documenso, téléverse le PDF, place un champ signature et
    l'envoie. Renvoie { document_id, token, signing_url }."""
    body = {
        "title": title,
        "recipients": [{"name": signer_name or signer_email, "email": signer_email, "role": "SIGNER"}],
    }
    if subject or message:
        body["meta"] = {"subject": subject, "message": message}

    r = httpx.post(f"{_base()}/documents", headers=_headers(), json=body, timeout=30)
    if r.status_code >= 300:
        raise DocumensoError(f"création document: {r.status_code} {r.text[:200]}")
    data = r.json()
    document_id = data["documentId"]
    recipients = data["recipients"]
    recipient_id = recipients[0]["recipientId"]
    token = recipients[0].get("token")

    up = httpx.put(
        data["uploadUrl"],
        content=pdf_bytes,
        headers={"Content-Type": "application/pdf"},
        timeout=60,
    )
    if up.status_code >= 300:
        raise DocumensoError(f"téléversement PDF: {up.status_code}")

    # Champ signature (coordonnées en % de page) sur la zone de signature du PDF.
    field = {
        "recipientId": recipient_id,
        "type": "SIGNATURE",
        "pageNumber": sign_page,
        "pageX": 8,
        "pageY": 78,
        "pageWidth": 36,
        "pageHeight": 12,
    }
    fr = httpx.post(f"{_base()}/documents/{document_id}/fields", headers=_headers(), json=field, timeout=30)
    if fr.status_code >= 300:
        raise DocumensoError(f"champ signature: {fr.status_code} {fr.text[:200]}")

    sr = httpx.post(
        f"{_base()}/documents/{document_id}/send",
        headers=_headers(),
        json={"sendEmail": bool(send_email)},
        timeout=30,
    )
    if sr.status_code >= 300:
        raise DocumensoError(f"envoi: {sr.status_code} {sr.text[:200]}")

    signing_url = f"{settings.documenso_url.rstrip('/')}/sign/{token}" if token else None
    return {"document_id": document_id, "token": token, "signing_url": signing_url}


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
