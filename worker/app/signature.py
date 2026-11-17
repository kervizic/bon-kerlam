"""Orchestration de la signature électronique des lettres de voiture (f).

Deux modes :
  - « sur place » : une enveloppe Documenso par lettre, sans e-mail (liens de
    signature renvoyés au front qui les enchaîne sur le téléphone du chauffeur) ;
  - « par mail » : UNE enveloppe groupée (PDF fusionné) envoyée au contact
    signataire ; les lettres passent « en attente de signature » (statut envoyee)
    jusqu'au retour, détecté par polling, puis archivées et marquées signées.

Toutes les lettres d'un envoi groupé doivent partager le même contact signataire.
"""

from __future__ import annotations

import io

import httpx

from . import db, documenso, pdf
from .config import settings


# Documenso — MÉTHODE 2 (retenue) : les positions des ancres #doc-signature /
# #doc-nom sont MESURÉES dans le rendu WeasyPrint (cf. pdf.measure_fields) puis
# posées en % de page. La méthode 1 (balises texte {{signature}}) n'est PAS détectée
# par notre Documenso à la création par l'API. beta.25 : le PDF et les positions de
# chaque lettre sont CACHÉS (bon.lv_pdf_cache) -> au moment de signer, on ne fait
# plus de rendu, seulement la fusion des PDF en cache (quelques ms).
def build_combined_pdf(lv_ids: list[int]) -> tuple[bytes, list[int], list[dict]]:
    """PDF combiné (un par envoi, chaque lettre sur de nouvelles pages) + champs
    Documenso, depuis le CACHE par lettre. Renvoie (pdf, dernières_pages, champs)."""
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    last_pages: list[int] = []
    fields: list[dict] = []
    offset = 0
    for lv_id in lv_ids:
        pdf_bytes, letter_fields, n_pages = pdf.letter_cached(lv_id)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages:
            writer.add_page(page)
        for f in letter_fields:
            fields.append({**f, "pageNumber": offset + f["pageNumber"]})
        offset += n_pages
        last_pages.append(offset)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue(), last_pages, fields


def _signer(lv_id: int) -> dict | None:
    return db.query_one(
        """
        SELECT lv.numero, lv.contact_id, ct.nom AS contact_nom, ct.email AS contact_email
          FROM bon.lettres_voiture lv
          LEFT JOIN bon.contacts ct ON ct.id = lv.contact_id
         WHERE lv.id = %s AND lv.deleted_at IS NULL
        """,
        (lv_id,),
    )


def _rows(lv_ids: list[int]) -> list[dict]:
    return db.query(
        "SELECT id, numero, contact_id, statut FROM bon.lettres_voiture "
        "WHERE id = ANY(%s) AND deleted_at IS NULL ORDER BY date_etablissement, id",
        (list(lv_ids),),
    )


def _validate_lot(lv_ids: list[int]) -> tuple[list[dict], dict]:
    """Valide un lot (toutes les lettres du MÊME contact signataire avec e-mail) et
    renvoie (lignes, signataire). Lève ValueError sinon."""
    rows = _rows(lv_ids)
    if not rows:
        raise ValueError("Aucune lettre valide.")
    contact_ids = {r["contact_id"] for r in rows}
    if len(contact_ids) != 1 or None in contact_ids:
        raise ValueError("Toutes les lettres doivent partager le même contact signataire.")
    signer = _signer(rows[0]["id"])
    if not signer or not signer.get("contact_email"):
        raise ValueError("Contact signataire sans e-mail.")
    return rows, signer


def _create_lot_document(
    rows: list[dict], signer: dict, *, send_email: bool, subject: str = "", message: str = "",
) -> dict:
    """UN SEUL document Documenso pour tout le lot : PDF combiné (une signature par
    lettre, positions mesurées) + 1 SIGNATURE + 1 NAME par lettre. Renvoie la réponse
    Documenso (document_id, token, signing_url)."""
    merged, _last, fields = build_combined_pdf([r["id"] for r in rows])
    numeros = ", ".join(str(r["numero"] or f"brouillon#{r['id']}") for r in rows)
    return documenso.create_document(
        title=f"Lettres de voiture KERLAM ({numeros})",
        signer_name=signer.get("contact_nom") or "",
        signer_email=signer["contact_email"],
        pdf_bytes=merged,
        send_email=send_email,
        fields=fields,
        subject=subject,
        message=message,
    )


def warm_cache(lv_ids: list[int]) -> dict:
    """Travail LOCAL uniquement (beta.25, décision Manu : AUCUN document Documenso
    par anticipation) : s'assure que le PDF de chaque lettre est rendu et mis en
    cache, pour que la création du document au toucher soit quasi instantanée.
    Aucun appel Documenso, aucun mail."""
    n = 0
    for lv_id in lv_ids:
        try:
            pdf.letter_cached(lv_id)
            n += 1
        except Exception:  # noqa: BLE001
            pass
    return {"warmed": n}


def sur_place(lv_ids: list[int]) -> dict:
    """UN SEUL document combiné (toutes les lettres du même signataire), créé AU
    TOUCHER sur « Signer sur ce téléphone ». distributionMethod=NONE : AUCUN mail.
    Toutes les lettres portent le même documenso_id. Renvoie le token (embed)."""
    rows, signer = _validate_lot(lv_ids)
    res = _create_lot_document(rows, signer, send_email=False)
    ids = [r["id"] for r in rows]
    db.query(
        "UPDATE bon.lettres_voiture SET documenso_document_id = %s, signature_mode = 'sur_place', "
        "signature_sent_at = now(), statut = 'a_signer' WHERE id = ANY(%s)",
        (res["document_id"], ids),
    )
    return {
        "document_id": res["document_id"],
        "token": res.get("token"),
        "signer_name": signer.get("contact_nom") or "",
        "signer_email": signer["contact_email"],
        "numeros": [r["numero"] or f"#{r['id']}" for r in rows],
        "lv_ids": ids,
    }


def par_mail(lv_ids: list[int]) -> dict:
    """UNE enveloppe groupée (PDF combiné, une signature par lettre) envoyée au
    contact signataire commun. Toutes les lettres portent le même documenso_id."""
    rows, signer = _validate_lot(lv_ids)
    res = _create_lot_document(
        rows, signer, send_email=True,
        subject="Lettres de voiture à signer — KERLAM",
        message="Bonjour, merci de signer les lettres de voiture KERLAM ci-jointes.",
    )
    ids = [r["id"] for r in rows]
    db.query(
        "UPDATE bon.lettres_voiture SET documenso_document_id = %s, signature_mode = 'par_mail', "
        "signature_sent_at = now(), statut = 'envoyee' WHERE id = ANY(%s)",
        (res["document_id"], ids),
    )
    return {"document_id": res["document_id"], "contact_email": signer["contact_email"], "lv_ids": ids}


def _archive_signed(document_id: int, pdf_bytes: bytes) -> str | None:
    """Téléverse le PDF signé dans le bucket privé. Best-effort (retourne la clé)."""
    if not settings.service_role_key or not pdf_bytes:
        return None
    key = f"{document_id}.pdf"
    url = f"{settings.storage_url}/storage/v1/object/{settings.signed_bucket}/{key}"
    try:
        r = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.service_role_key}",
                "Content-Type": "application/pdf",
                "x-upsert": "true",
            },
            content=pdf_bytes,
            timeout=30,
        )
        if r.status_code < 300:
            return f"{settings.signed_bucket}/{key}"
    except Exception:  # noqa: BLE001
        pass
    return None


def poll_pending() -> dict:
    """Vérifie les enveloppes en attente ; archive et marque signées celles
    terminées côté Documenso. Un document groupé rattache le PDF à ses N lettres."""
    pending = db.query(
        "SELECT DISTINCT documenso_document_id FROM bon.lettres_voiture "
        "WHERE documenso_document_id IS NOT NULL AND signed_pdf_path IS NULL "
        "AND statut IN ('a_signer', 'envoyee') AND deleted_at IS NULL"
    )
    completed = 0
    for row in pending:
        doc_id = row["documenso_document_id"]
        try:
            if not documenso.is_completed(doc_id):
                continue
            signed = documenso.download_signed(doc_id)
            path = _archive_signed(doc_id, signed) if signed else None
            db.query(
                "UPDATE bon.lettres_voiture SET statut = 'signee', signed_pdf_path = COALESCE(%s, signed_pdf_path) "
                "WHERE documenso_document_id = %s AND deleted_at IS NULL",
                (path, doc_id),
            )
            # UN SEUL mail KERLAM au contact (KERLAM en copie), avec le PDF signé.
            if signed:
                _send_signed_mail(doc_id, signed)
            completed += 1
        except Exception:  # noqa: BLE001
            continue
    return {"verifiees": len(pending), "signees": completed}


def _send_signed_mail(doc_id: int, signed_pdf: bytes) -> None:
    """Envoie, au nom de KERLAM, UN SEUL mail au contact signataire (KERLAM en copie)
    avec le PDF signé en pièce jointe. Objet = numéros réels. Best-effort."""
    from . import mailer

    rows = db.query(
        "SELECT lv.numero, ct.email AS contact_email FROM bon.lettres_voiture lv "
        "LEFT JOIN bon.contacts ct ON ct.id = lv.contact_id "
        "WHERE lv.documenso_document_id = %s AND lv.deleted_at IS NULL "
        "ORDER BY lv.date_etablissement, lv.id",
        (doc_id,),
    )
    if not rows:
        return
    to = rows[0].get("contact_email")
    if not to:
        return
    numeros = [r["numero"] for r in rows if r.get("numero")]
    plage = numeros[0] if len(numeros) == 1 else (f"{numeros[0]} à {numeros[-1]}" if numeros else "KERLAM")
    nb = len(numeros)
    subject = f"Lettres de voiture signées : {plage}"
    quoi = "la lettre de voiture signée" if nb <= 1 else "les lettres de voiture signées"
    body = (
        f"Bonjour,\n\nVeuillez trouver ci-joint {quoi}"
        f" ({', '.join(numeros) if numeros else 'KERLAM'}).\n\nCordialement,\nKERLAM"
    )
    mailer.send_mail(
        to=to, subject=subject, body=body,
        attachment=(f"lettres-voiture-{plage.replace(' ', '-')}.pdf", signed_pdf, "application/pdf"),
    )
