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

# Documenso — MÉTHODE 2 (retenue) : le worker MESURE la position réelle des ancres
# #doc-signature / #doc-nom dans le rendu WeasyPrint (la zone signature est en flux,
# sa position varie d'une lettre à l'autre) et crée les champs à ces coordonnées en
# % de page. La méthode 1 (balises texte {{signature}}) n'est PAS détectée par notre
# version de Documenso lors d'une création par l'API (vérifié : 0 champ auto-créé).
_ANCHORS = (("SIGNATURE", "doc-signature"), ("NAME", "doc-nom"))


def anchor_field(field_type: str, page_number: int, box, page_w: float, page_h: float) -> dict:
    """Convertit une boîte d'ancre WeasyPrint (x0, y0, x1, y1 en px, origine
    haut-gauche) en champ Documenso (% de page). Fonction pure, testée."""
    x0, y0, x1, y1 = box
    return {
        "type": field_type,
        "pageNumber": page_number,
        "pageX": round(x0 / page_w * 100, 4),
        "pageY": round(y0 / page_h * 100, 4),
        "pageWidth": round((x1 - x0) / page_w * 100, 4),
        "pageHeight": round((y1 - y0) / page_h * 100, 4),
    }


def _fields_from_document(document, page_offset: int) -> list[dict]:
    """Champs SIGNATURE + NAME d'UNE lettre, mesurés sur ses pages WeasyPrint.
    page_offset = nombre de pages déjà accumulées dans le PDF combiné (les numéros
    de page Documenso sont 1-based et absolus dans le combiné)."""
    fields: list[dict] = []
    for i, page in enumerate(document.pages):
        for ftype, anchor in _ANCHORS:
            box = page.anchors.get(anchor)
            if box:
                fields.append(anchor_field(ftype, page_offset + i + 1, box, page.width, page.height))
    return fields


def build_combined_pdf(lv_ids: list[int]) -> tuple[bytes, list[int], list[dict]]:
    """Construit le PDF combiné (un par envoi, chaque lettre sur de nouvelles pages)
    et MESURE les champs Documenso. Renvoie (pdf, dernières_pages, champs) :
    dernières_pages[k] = dernière page (1-based) de la lettre k ; champs = liste de
    géométries SIGNATURE/NAME (sans recipientId), une paire par lettre, à la bonne page."""
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    last_pages: list[int] = []
    fields: list[dict] = []
    offset = 0
    for lv_id in lv_ids:
        document = pdf.render_document(pdf.build_context(lv_id))
        fields.extend(_fields_from_document(document, offset))
        reader = PdfReader(io.BytesIO(document.write_pdf()))
        for page in reader.pages:
            writer.add_page(page)
        offset += len(document.pages)
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


def sur_place(lv_ids: list[int]) -> list[dict]:
    """Une enveloppe par lettre (sans e-mail). Renvoie les liens de signature."""
    out = []
    for lv_id in lv_ids:
        signer = _signer(lv_id)
        if not signer or not signer.get("contact_email"):
            raise ValueError(f"Lettre {lv_id} : aucun contact signataire avec e-mail.")
        # Une seule lettre : signature + nom mesurés sur SA page.
        pdf_bytes, _last, fields = build_combined_pdf([lv_id])
        res = documenso.create_document(
            title=f"Lettre de voiture {signer.get('numero') or lv_id}",
            signer_name=signer.get("contact_nom") or "",
            signer_email=signer["contact_email"],
            pdf_bytes=pdf_bytes,
            send_email=False,
            fields=fields,
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
    # propre signature + nom mesurés sur SA zone (art. 5 : une signature par lettre).
    merged, _last, fields = build_combined_pdf([r["id"] for r in rows])

    numeros = ", ".join(str(r["numero"] or f"brouillon#{r['id']}") for r in rows)
    res = documenso.create_document(
        title=f"Lettres de voiture KERLAM ({numeros})",
        signer_name=signer.get("contact_nom") or "",
        signer_email=signer["contact_email"],
        pdf_bytes=merged,
        send_email=True,
        fields=fields,
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
