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


# Ancres Documenso (maquette épurée beta.23). Origine = coin HAUT-GAUCHE de la
# page A4 (210 × 297 mm). Coordonnées en mm (x, y, largeur, hauteur) ; converties
# en % de page pour l'API Documenso (pageX/pageY/pageWidth/pageHeight).
A4_W_MM = 210.0
A4_H_MM = 297.0
_ANCHOR_MM = {
    "SIGNATURE": (17.0, 245.0, 66.0, 15.0),
    "NAME": (17.0, 262.0, 66.0, 5.0),
}


def _pct_field(field_type: str, page_number: int) -> dict:
    """Géométrie d'un champ Documenso en % de page, pour une page donnée."""
    x_mm, y_mm, w_mm, h_mm = _ANCHOR_MM[field_type]
    return {
        "type": field_type,
        "pageNumber": page_number,
        "pageX": round(x_mm / A4_W_MM * 100, 4),
        "pageY": round(y_mm / A4_H_MM * 100, 4),
        "pageWidth": round(w_mm / A4_W_MM * 100, 4),
        "pageHeight": round(h_mm / A4_H_MM * 100, 4),
    }


def signature_fields(last_pages: list[int]) -> list[dict]:
    """Champs SIGNATURE + NAME pour chaque lettre, placés sur la DERNIÈRE page de
    la lettre dans le PDF (combiné ou non). `last_pages` : numéros de page (1-based)
    de la dernière page de chaque lettre. Géométrie seule (sans recipientId)."""
    fields: list[dict] = []
    for page in last_pages:
        fields.append(_pct_field("SIGNATURE", page))
        fields.append(_pct_field("NAME", page))
    return fields


def build_combined_pdf(lv_ids: list[int]) -> tuple[bytes, list[int]]:
    """Fusionne les PDF des lettres (un PDF par envoi, chaque lettre sur de
    nouvelles pages). Renvoie (pdf_fusionné, dernières_pages) où dernières_pages[k]
    est le numéro de page (1-based) de la dernière page de la lettre k."""
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    last_pages: list[int] = []
    for lv_id in lv_ids:
        reader = PdfReader(io.BytesIO(_build_pdf(lv_id)))
        for page in reader.pages:
            writer.add_page(page)
        last_pages.append(len(writer.pages))  # dernière page de cette lettre
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue(), last_pages


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
        # Une seule lettre : signature + nom sur SA dernière page.
        pdf_bytes, last_pages = build_combined_pdf([lv_id])
        res = documenso.create_document(
            title=f"Lettre de voiture {signer.get('numero') or lv_id}",
            signer_name=signer.get("contact_nom") or "",
            signer_email=signer["contact_email"],
            pdf_bytes=pdf_bytes,
            send_email=False,
            fields=signature_fields(last_pages),
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

    # PDF combiné (un par envoi) : chaque lettre sur de nouvelles pages, avec sa
    # propre signature + nom sur SA dernière page (art. 5 : une signature par lettre).
    merged, last_pages = build_combined_pdf([r["id"] for r in rows])

    numeros = ", ".join(str(r["numero"] or f"brouillon#{r['id']}") for r in rows)
    res = documenso.create_document(
        title=f"Lettres de voiture KERLAM ({numeros})",
        signer_name=signer.get("contact_nom") or "",
        signer_email=signer["contact_email"],
        pdf_bytes=merged,
        send_email=True,
        fields=signature_fields(last_pages),
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
