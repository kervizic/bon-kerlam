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


def _build_pdf(lv_id: int) -> bytes:
    return pdf.render_pdf(pdf.build_context(lv_id))


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


def sur_place(lv_ids: list[int]) -> list[dict]:
    """Une enveloppe par lettre (sans e-mail). Renvoie les liens de signature."""
    out = []
    for lv_id in lv_ids:
        signer = _signer(lv_id)
        if not signer or not signer.get("contact_email"):
            raise ValueError(f"Lettre {lv_id} : aucun contact signataire avec e-mail.")
        res = documenso.create_document(
            title=f"Lettre de voiture {signer.get('numero') or lv_id}",
            signer_name=signer.get("contact_nom") or "",
            signer_email=signer["contact_email"],
            pdf_bytes=_build_pdf(lv_id),
            send_email=False,
        )
        db.query(
            "UPDATE bon.lettres_voiture SET documenso_document_id = %s, signature_mode = 'sur_place', "
            "signature_sent_at = now(), statut = 'a_signer' WHERE id = %s",
            (res["document_id"], lv_id),
        )
        out.append({"lv_id": lv_id, "numero": signer.get("numero"), "signing_url": res["signing_url"]})
    return out


def par_mail(lv_ids: list[int]) -> dict:
    """UNE enveloppe groupée (PDF fusionné) envoyée au contact signataire commun."""
    rows = _rows(lv_ids)
    if not rows:
        raise ValueError("Aucune lettre valide.")
    contact_ids = {r["contact_id"] for r in rows}
    if len(contact_ids) != 1 or None in contact_ids:
        raise ValueError("Toutes les lettres doivent partager le même contact signataire.")
    signer = _signer(rows[0]["id"])
    if not signer or not signer.get("contact_email"):
        raise ValueError("Contact signataire sans e-mail.")

    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for r in rows:
        reader = PdfReader(io.BytesIO(_build_pdf(r["id"])))
        for page in reader.pages:
            writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    merged = buf.getvalue()
    last_page = len(writer.pages)

    numeros = ", ".join(str(r["numero"] or f"brouillon#{r['id']}") for r in rows)
    res = documenso.create_document(
        title=f"Lettres de voiture KERLAM ({numeros})",
        signer_name=signer.get("contact_nom") or "",
        signer_email=signer["contact_email"],
        pdf_bytes=merged,
        send_email=True,
        sign_page=last_page,
        subject="Lettres de voiture à signer — KERLAM",
        message="Bonjour, merci de signer les lettres de voiture KERLAM ci-jointes.",
    )
    for r in rows:
        db.query(
            "UPDATE bon.lettres_voiture SET documenso_document_id = %s, signature_mode = 'par_mail', "
            "signature_sent_at = now(), statut = 'envoyee' WHERE id = %s",
            (res["document_id"], r["id"]),
        )
    return {
        "document_id": res["document_id"],
        "contact_email": signer["contact_email"],
        "lv_ids": [r["id"] for r in rows],
    }


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
            completed += 1
        except Exception:  # noqa: BLE001
            continue
    return {"verifiees": len(pending), "signees": completed}
