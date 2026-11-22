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


# Tous les e-mails AUTOMATIQUES de Documenso coupés (beta.25 : le client ne doit
# recevoir aucun mail parasite — « Document annulé » à la suppression, etc.). En
# mode « par mail », seule l'invitation à signer (recipientSigningRequest) est
# réactivée. Les mails de fin sont envoyés par NOTRE worker, avec le PDF signé.
EMAIL_ALL_OFF = {
    "recipientSigningRequest": False, "recipientSigned": False, "recipientRemoved": False,
    "documentPending": False, "documentCompleted": False, "documentDeleted": False,
    "ownerDocumentCreated": False, "ownerRecipientExpired": False, "ownerDocumentCompleted": False,
}


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

    E-mails Documenso : TOUS coupés (meta.emailSettings) ; distributionMethod = NONE
    (présentiel, aucun mail) ou EMAIL (par mail : seule l'invitation à signer part).
    `fields` : géométrie en % de page (sans recipientId, injecté ici)."""
    email_settings = dict(EMAIL_ALL_OFF)
    if send_email:
        email_settings["recipientSigningRequest"] = True  # seule l'invitation
    meta = {
        "distributionMethod": "EMAIL" if send_email else "NONE",
        "emailSettings": email_settings,
    }
    if subject:
        meta["subject"] = subject
    if message:
        meta["message"] = message
    body = {
        "title": title,
        "recipients": [{"name": signer_name or signer_email, "email": signer_email, "role": "SIGNER"}],
        "meta": meta,
    }

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

        # beta.29 : TOUS les champs en UN SEUL appel. L'API v1 2.21 accepte un
        # tableau sur POST /documents/{id}/fields (oneOf object|array) -> un aller-
        # retour au lieu de N. Les champs sont posés AVANT /send.
        field_bodies = [{"recipientId": recipient_id, **geom} for geom in fields]
        fr = client.post(f"{_base()}/documents/{document_id}/fields", json=field_bodies)
        if fr.status_code >= 300:
            raise DocumensoError(f"champs: {fr.status_code} {fr.text[:200]}")

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


def resend_document(document_id: int) -> bool:
    """Mode « par mail » : renvoie l'invitation à signer au(x) destinataire(s)
    (Documenso renvoie un mail — c'est VOULU, action « Renvoyer le lien »)."""
    detail = document_status(document_id)
    recipients = detail.get("recipients") or []
    ids = [rc["recipientId"] for rc in recipients if rc.get("recipientId") is not None
           and str(rc.get("signingStatus", "")).upper() != "SIGNED"]
    if not ids:
        ids = [rc["recipientId"] for rc in recipients if rc.get("recipientId") is not None]
    r = httpx.post(f"{_base()}/documents/{document_id}/resend",
                   headers=_headers(), json={"recipients": ids}, timeout=30)
    return r.status_code < 300


# --- Signature SANS page embed (beta.33) : endpoints tRPC internes --------------
# Le dessin du client (PNG base64) est posé sur le champ via le SEUL token du
# destinataire, puis le document est complété. Documenso scelle (PAdES) comme l'embed.
# PoC validé 19/11 : l'en-tête Origin est OBLIGATOIRE (403 sinon). Format SuperJSON
# non-batch : corps enveloppé dans {"json": {...}}.
def _trpc_base() -> str:
    return settings.documenso_url.rstrip("/") + "/api/trpc"


def _origin() -> str:
    return settings.documenso_url.rstrip("/")


def _trpc(proc: str, payload: dict, token: str, timeout: float = 30.0) -> dict:
    headers = {
        "Content-Type": "application/json",
        "Origin": _origin(),
        "Referer": f"{_origin()}/sign/{token}",
        "User-Agent": "bon-kerlam-worker",
    }
    r = httpx.post(f"{_trpc_base()}/{proc}", headers=headers, json={"json": payload}, timeout=timeout)
    if r.status_code >= 300:
        raise DocumensoError(f"tRPC {proc}: {r.status_code} {r.text[:200]}")
    return r.json()


def document_signature_fields(document_id: int) -> tuple[str | None, list[int]]:
    """(token destinataire, liste des ids de champs SIGNATURE) depuis le détail v1."""
    detail = document_status(document_id)
    recipients = detail.get("recipients") or []
    token = recipients[0].get("token") if recipients else None
    fields = detail.get("fields") or (recipients[0].get("fields") if recipients else []) or []
    field_ids = [f["id"] for f in fields if str(f.get("type", "")).upper() == "SIGNATURE"]
    return token, field_ids


def sign_field_with_token(token: str, field_id: int, value_data_url: str) -> dict:
    """Pose la signature DESSINÉE (data URL PNG complète) sur un champ, token seul."""
    return _trpc("field.signFieldWithToken",
                 {"token": token, "fieldId": field_id, "value": value_data_url, "isBase64": True},
                 token)


def complete_document_with_token(token: str, document_id: int) -> dict:
    """Termine le document (déclenche le scellement PAdES côté Documenso), token seul."""
    return _trpc("recipient.completeDocumentWithToken",
                 {"token": token, "documentId": document_id}, token)
