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

import base64
import contextlib
import io
import logging
import time

import httpx

from . import db, documenso, pdf
from .config import settings

log = logging.getLogger("bon.signature")


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


class SignatureConflict(Exception):
    """Une lettre du lot est déjà signée ou déjà en signature active (beta.29).
    Mappé en HTTP 409 par l'API : on ne renvoie jamais en signature une lettre signée."""


def _rows(lv_ids: list[int]) -> list[dict]:
    return db.query(
        "SELECT id, numero, contact_id, statut, documenso_document_id FROM bon.lettres_voiture "
        "WHERE id = ANY(%s) AND deleted_at IS NULL ORDER BY date_etablissement, id",
        (list(lv_ids),),
    )


def _assert_signable(rows: list[dict]) -> None:
    """beta.29 : refuse (409) toute lettre déjà signée ou en signature active
    (a_signer/envoyee avec un document Documenso attaché)."""
    signees = [r["numero"] or f"#{r['id']}" for r in rows if r["statut"] == "signee"]
    if signees:
        raise SignatureConflict(f"Déjà signée(s) : {', '.join(map(str, signees))}.")
    actives = [
        r["numero"] or f"#{r['id']}"
        for r in rows
        if r["statut"] in ("a_signer", "envoyee") and r.get("documenso_document_id") is not None
    ]
    if actives:
        raise SignatureConflict(f"Déjà en cours de signature : {', '.join(map(str, actives))}.")


def _validate_lot(lv_ids: list[int]) -> tuple[list[dict], dict]:
    """Valide un lot (toutes les lettres du MÊME contact signataire avec e-mail) et
    renvoie (lignes, signataire). Lève ValueError / SignatureConflict sinon."""
    rows = _rows(lv_ids)
    if not rows:
        raise ValueError("Aucune lettre valide.")
    _assert_signable(rows)
    contact_ids = {r["contact_id"] for r in rows}
    if len(contact_ids) != 1 or None in contact_ids:
        raise ValueError("Toutes les lettres doivent partager le même contact signataire.")
    signer = _signer(rows[0]["id"])
    if not signer or not signer.get("contact_email"):
        raise ValueError("Contact signataire sans e-mail.")
    return rows, signer


def _validate_lot_for_enqueue(lv_ids: list[int]) -> tuple[list[dict], dict]:
    """Comme _validate_lot mais SANS 409 « déjà en signature » (beta.33 : la reprise
    d'une signature en cours est gérée par l'appli). On refuse seulement les lettres
    déjà SIGNÉES (jamais re-signer une lettre signée), et on exige un contact unique
    avec e-mail."""
    rows = _rows(lv_ids)
    if not rows:
        raise ValueError("Aucune lettre valide.")
    signees = [r["numero"] or f"#{r['id']}" for r in rows if r["statut"] == "signee"]
    if signees:
        raise SignatureConflict(f"Déjà signée(s) : {', '.join(map(str, signees))}.")
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


def warm_cache(lv_ids: list[int], priority: int | None = None) -> dict:
    """Travail LOCAL uniquement (beta.25, décision Manu : AUCUN document Documenso
    par anticipation) : s'assure que le PDF de chaque lettre est rendu et mis en
    cache, pour que la création du document au toucher soit quasi instantanée.
    Aucun appel Documenso, aucun mail. beta.32 : `priority` route vers l'ordonnanceur
    (PRIO_SIGN quand l'utilisateur prépare une signature, PRIO_BG au préchauffage)."""
    from .render import PRIO_SIGN

    prio = PRIO_SIGN if priority is None else priority
    n = 0
    for lv_id in lv_ids:
        try:
            pdf.letter_cached(lv_id, prio)
            n += 1
        except Exception:  # noqa: BLE001
            pass
    return {"warmed": n}


def enqueue_sur_place(lv_ids: list[int], signature_png: str) -> dict:
    """beta.33 — signature SUR PLACE, ORDRE INVERSÉ : le client a déjà dessiné sa
    signature (PNG) DANS l'appli. On n'a RIEN créé côté Documenso. Ici on se contente
    de déposer le dessin dans la file PERSISTANTE (bon.signature_jobs) et de marquer
    les lettres « enregistrement… ». Le worker fera tout le reste en tâche de fond
    (création document, signature tRPC, scellement, archivage, mail). Retour immédiat.
    """
    rows, signer = _validate_lot_for_enqueue(lv_ids)
    if not isinstance(signature_png, str) or not signature_png.startswith("data:image"):
        raise ValueError("Signature (PNG data URL) manquante ou invalide.")
    ids = [r["id"] for r in rows]
    # Dépose le job PUIS verrouille les lettres en « enregistrement », dans la même
    # transaction (une seule connexion autocommit : on fait les deux à la suite).
    db.query(
        "INSERT INTO bon.signature_jobs (lv_ids, signer_name, signer_email, signature_png) "
        "VALUES (%s, %s, %s, %s)",
        (ids, signer.get("contact_nom") or "", signer["contact_email"], signature_png),
    )
    db.query(
        "UPDATE bon.lettres_voiture SET signature_mode = 'sur_place', signature_sent_at = now(), "
        "statut = 'a_signer', signature_job_state = 'recording', documenso_document_id = NULL "
        "WHERE id = ANY(%s)",
        (ids,),
    )
    return {"ok": True, "numeros": [r["numero"] or f"#{r['id']}" for r in rows], "lv_ids": ids}


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
    """Téléverse le PDF signé dans le bucket privé et renvoie la clé d'archive.

    beta.29 : le service Storage expose ses routes SANS le préfixe `/storage/v1`
    (celui-ci est ajouté par la passerelle) -> on poste sur `{url}/object/...`.
    Les erreurs ne sont plus avalées en silence : elles sont journalisées pour que
    l'échec d'archivage soit visible dans les logs du worker."""
    if not settings.service_role_key or not pdf_bytes:
        if not settings.service_role_key:
            log.warning("archivage doc %s ignoré : SERVICE_ROLE_KEY absente", document_id)
        return None
    key = f"{document_id}.pdf"
    url = f"{settings.storage_url}/object/{settings.signed_bucket}/{key}"
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
        log.error("archivage doc %s échoué: HTTP %s %s", document_id, r.status_code, r.text[:200])
    except Exception as exc:  # noqa: BLE001
        log.error("archivage doc %s exception: %r", document_id, exc)
    return None


def signable_lv_ids(limit: int = 50) -> list[int]:
    """Lettres SIGNABLES (en cours / à signer, non signées, avec contact), pour la
    préchauffe du cache PDF au démarrage (beta.29). Bornée pour ne pas tout rendre."""
    rows = db.query(
        "SELECT id FROM bon.lettres_voiture "
        "WHERE statut IN ('en_cours', 'a_signer') AND deleted_at IS NULL "
        "AND contact_id IS NOT NULL "
        "ORDER BY date_etablissement DESC, id DESC LIMIT %s",
        (limit,),
    )
    return [r["id"] for r in rows]


def active_signature_count() -> int:
    """Nombre de lettres en signature ACTIVE (envoyées/à signer, pas encore
    archivées). Sert à resserrer la fréquence de la boucle de fond (beta.29)."""
    rows = db.query(
        "SELECT count(*) AS n FROM bon.lettres_voiture "
        "WHERE documenso_document_id IS NOT NULL AND signed_pdf_path IS NULL "
        "AND statut IN ('a_signer', 'envoyee') AND deleted_at IS NULL"
    )
    return int(rows[0]["n"]) if rows else 0


def poll_pending(document_id: int | None = None, wait_s: float = 0.0) -> dict:
    """Vérifie les enveloppes en attente ; archive et marque signées celles
    terminées côté Documenso. Un document groupé rattache le PDF à ses N lettres.

    beta.29 : si `document_id` est fourni avec `wait_s>0`, on attend (de façon
    BORNÉE) que CE document passe COMPLETED côté Documenso — la signature intégrée
    met quelques secondes à se propager — avant de traiter les enveloppes."""
    if document_id is not None and wait_s > 0:
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline:
            try:
                if documenso.is_completed(document_id):
                    break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(1.0)
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
            # beta.31 : le PDF signé est archivé à part -> on retire l'entrée de cache
            # (reconstructible) de ces lettres pour ne pas garder d'octets inutiles.
            with contextlib.suppress(Exception):
                pdf.drop_cache_for_document(doc_id)
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


# ====================================================================== beta.33
# Traitement de fond de la file de signature SUR PLACE (bon.signature_jobs).
# Ordre inversé : tout se fait ICI, après que le client a validé son dessin.

_MAX_ATTEMPTS = 3
_RETRY_DELAY_S = 30          # délai entre deux tentatives d'un même job
_SEAL_WAIT_S = 30.0         # attente max du scellement COMPLETED côté Documenso
_STUCK_SUR_PLACE_MIN = 15   # ménage : sur place non terminée depuis > 15 min
_MAIL_EXPIRY_DAYS = 7       # mode mail : expiration automatique


def _doc_id_for_lv(lv_ids: list[int]) -> int | None:
    rows = db.query(
        "SELECT DISTINCT documenso_document_id FROM bon.lettres_voiture "
        "WHERE id = ANY(%s) AND documenso_document_id IS NOT NULL",
        (list(lv_ids),),
    )
    return rows[0]["documenso_document_id"] if rows else None


def _store_failed_png(job_id: int, data_url: str) -> str | None:
    """Conserve le PNG d'une tentative échouée dans le bucket privé 30 j (diagnostic,
    jamais sur le PDF). Best-effort."""
    if not settings.service_role_key or not data_url:
        return None
    try:
        b64 = data_url.split(",", 1)[1]
        raw = base64.b64decode(b64)
    except Exception:  # noqa: BLE001
        return None
    key = f"signature-echecs/{job_id}.png"
    url = f"{settings.storage_url}/object/{settings.docs_bucket}/{key}"
    try:
        r = httpx.post(url, headers={"Authorization": f"Bearer {settings.service_role_key}",
                                     "Content-Type": "image/png", "x-upsert": "true"},
                       content=raw, timeout=30)
        if r.status_code < 300:
            return f"{settings.docs_bucket}/{key}"
        log.error("conservation PNG échec job %s: HTTP %s", job_id, r.status_code)
    except Exception as exc:  # noqa: BLE001
        log.error("conservation PNG échec job %s: %r", job_id, exc)
    return None


def _mark_signed(doc_id: int, signed_pdf: bytes | None) -> None:
    """Archive le PDF signé, passe les lettres à « signee », purge le cache, envoie le
    mail KERLAM unique (comme beta.29)."""
    path = _archive_signed(doc_id, signed_pdf) if signed_pdf else None
    db.query(
        "UPDATE bon.lettres_voiture SET statut = 'signee', signature_job_state = NULL, "
        "signed_pdf_path = COALESCE(%s, signed_pdf_path) "
        "WHERE documenso_document_id = %s AND deleted_at IS NULL",
        (path, doc_id),
    )
    with contextlib.suppress(Exception):
        pdf.drop_cache_for_document(doc_id)
    if signed_pdf:
        with contextlib.suppress(Exception):
            _send_signed_mail(doc_id, signed_pdf)


def _claim_next_job() -> dict | None:
    """Réclame atomiquement le prochain job à traiter (rejouable : un job resté
    'processing' après un redémarrage est repris)."""
    rows = db.query(
        "UPDATE bon.signature_jobs SET status = 'processing', updated_at = now() "
        "WHERE id = (SELECT id FROM bon.signature_jobs "
        "            WHERE status IN ('pending','processing') AND next_attempt_at <= now() "
        "            ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) "
        "RETURNING *"
    )
    return rows[0] if rows else None


def _run_job(job: dict) -> None:
    """Exécute UN job : crée le document (si besoin), pose la signature sur chaque
    champ, complète, attend le scellement, archive, marque signé, envoie le mail."""
    job_id = job["id"]
    lv_ids = list(job["lv_ids"])
    png = job["signature_png"]
    doc_id = job.get("document_id")

    # 1) Créer le document Documenso (une seule fois ; idempotent après redémarrage).
    if not doc_id:
        rows = _rows(lv_ids)
        if not rows:
            raise ValueError("Lettres du job introuvables.")
        signer = {"contact_nom": job.get("signer_name"), "contact_email": job["signer_email"]}
        res = _create_lot_document(rows, signer, send_email=False)
        doc_id = res["document_id"]
        db.query("UPDATE bon.signature_jobs SET document_id = %s, updated_at = now() WHERE id = %s",
                 (doc_id, job_id))
        db.query("UPDATE bon.lettres_voiture SET documenso_document_id = %s WHERE id = ANY(%s)",
                 (doc_id, lv_ids))

    # 2) Poser le dessin sur CHAQUE champ SIGNATURE (token du destinataire seul).
    token, field_ids = documenso.document_signature_fields(doc_id)
    if not token or not field_ids:
        raise documenso.DocumensoError(f"token/champs introuvables pour doc {doc_id}")
    for fid in field_ids:
        documenso.sign_field_with_token(token, fid, png)

    # 3) Terminer -> scellement PAdES asynchrone côté Documenso.
    documenso.complete_document_with_token(token, doc_id)

    # 4) Attendre COMPLETED (borné), télécharger, archiver, marquer signé, mailer.
    deadline = time.monotonic() + _SEAL_WAIT_S
    while time.monotonic() < deadline:
        with contextlib.suppress(Exception):
            if documenso.is_completed(doc_id):
                break
        time.sleep(1.0)
    signed = None
    with contextlib.suppress(Exception):
        signed = documenso.download_signed(doc_id)
    _mark_signed(doc_id, signed)
    db.query("UPDATE bon.signature_jobs SET status = 'done', updated_at = now() WHERE id = %s", (job_id,))


def _fail_job(job: dict, exc: Exception) -> None:
    """Échec d'une tentative : réessaie (délai) ou, après _MAX_ATTEMPTS, abandonne —
    supprime le document créé (SANS mail), remet les lettres « à signer » + bandeau
    « à refaire », conserve le PNG pour diagnostic."""
    job_id = job["id"]
    attempts = (job.get("attempts") or 0) + 1
    err = f"{type(exc).__name__}: {exc}"[:500]
    if attempts < _MAX_ATTEMPTS:
        db.query(
            "UPDATE bon.signature_jobs SET status = 'pending', attempts = %s, last_error = %s, "
            "next_attempt_at = now() + make_interval(secs => %s), updated_at = now() WHERE id = %s",
            (attempts, err, _RETRY_DELAY_S, job_id),
        )
        log.warning("job signature %s tentative %s échouée: %s", job_id, attempts, err)
        return
    # Abandon définitif.
    doc_id = job.get("document_id") or _doc_id_for_lv(list(job["lv_ids"]))
    if doc_id:
        with contextlib.suppress(Exception):
            documenso.delete_document(doc_id)  # emailSettings tous false -> aucun mail
    png_path = _store_failed_png(job_id, job.get("signature_png") or "")
    db.query(
        "UPDATE bon.lettres_voiture SET statut = 'a_signer', signature_job_state = 'failed', "
        "documenso_document_id = NULL WHERE id = ANY(%s)",
        (list(job["lv_ids"]),),
    )
    db.query(
        "UPDATE bon.signature_jobs SET status = 'failed', attempts = %s, last_error = %s, "
        "png_path = %s, updated_at = now() WHERE id = %s",
        (attempts, err, png_path, job_id),
    )
    log.error("job signature %s ABANDONNÉ après %s tentatives: %s", job_id, attempts, err)


def process_signature_jobs() -> dict:
    """Traite UN job de la file (appelé en boucle par le worker). Renvoie l'id traité."""
    job = _claim_next_job()
    if not job:
        return {"processed": None}
    try:
        _run_job(job)
        return {"processed": job["id"], "ok": True}
    except Exception as exc:  # noqa: BLE001
        _fail_job(job, exc)
        return {"processed": job["id"], "ok": False}


def cleanup_stuck_signatures() -> dict:
    """Anti-blocage périodique :
    - SUR PLACE non terminée depuis > 15 min -> document supprimé (sans mail), lettre
      remise « à signer » (file nettoyée).
    - MODE MAIL expiré (> 7 j sans signature) -> annulation sans mail, lettre « à signer ».
    """
    cleaned = 0
    # Sur place bloquée : jobs toujours en file et lettres en « recording » anciennes.
    stuck = db.query(
        "SELECT DISTINCT documenso_document_id AS doc, array_agg(id) AS ids "
        "FROM bon.lettres_voiture "
        "WHERE signature_job_state = 'recording' AND signature_mode = 'sur_place' "
        "AND signature_sent_at < now() - make_interval(mins => %s) AND deleted_at IS NULL "
        "GROUP BY documenso_document_id",
        (_STUCK_SUR_PLACE_MIN,),
    )
    for row in stuck:
        ids = list(row["ids"])
        doc = row["doc"]
        if doc:
            with contextlib.suppress(Exception):
                documenso.delete_document(doc)
        db.query(
            "UPDATE bon.lettres_voiture SET statut = 'a_signer', signature_job_state = NULL, "
            "documenso_document_id = NULL WHERE id = ANY(%s)",
            (ids,),
        )
        db.query(
            "UPDATE bon.signature_jobs SET status = 'failed', last_error = 'stuck>15min', "
            "updated_at = now() WHERE lv_ids && %s AND status IN ('pending','processing')",
            (ids,),
        )
        cleaned += 1
    # Mode mail expiré.
    expired = db.query(
        "SELECT DISTINCT documenso_document_id AS doc, array_agg(id) AS ids "
        "FROM bon.lettres_voiture "
        "WHERE signature_mode = 'par_mail' AND statut = 'envoyee' "
        "AND signature_sent_at < now() - make_interval(days => %s) AND deleted_at IS NULL "
        "GROUP BY documenso_document_id",
        (_MAIL_EXPIRY_DAYS,),
    )
    for row in expired:
        _cancel_doc(row["doc"], list(row["ids"]))
        cleaned += 1
    return {"cleaned": cleaned}


def _cancel_doc(doc_id: int | None, ids: list[int]) -> None:
    """Supprime le document Documenso (SANS mail) et remet les lettres « à signer »."""
    if doc_id:
        with contextlib.suppress(Exception):
            documenso.delete_document(doc_id)
    db.query(
        "UPDATE bon.lettres_voiture SET statut = 'a_signer', signature_mode = NULL, "
        "signature_job_state = NULL, documenso_document_id = NULL, signature_sent_at = NULL "
        "WHERE id = ANY(%s)",
        (ids,),
    )
    db.query(
        "UPDATE bon.signature_jobs SET status = 'failed', last_error = 'cancelled', "
        "updated_at = now() WHERE lv_ids && %s AND status IN ('pending','processing')",
        (ids,),
    )


def cancel_signature(lv_ids: list[int]) -> dict:
    """Annule la signature en cours d'un lot (sur place OU mail) : supprime le document
    (SANS mail) et remet les lettres « à signer ». Jamais sur une lettre signée."""
    rows = _rows(lv_ids)
    signees = [r["id"] for r in rows if r["statut"] == "signee"]
    if signees:
        raise SignatureConflict("Lettre déjà signée : annulation impossible.")
    ids = [r["id"] for r in rows]
    _cancel_doc(_doc_id_for_lv(ids), ids)
    return {"cancelled": ids}


def resend_mail(lv_ids: list[int]) -> dict:
    """Mode mail : renvoie l'invitation à signer au client (Documenso renvoie un mail)."""
    doc_id = _doc_id_for_lv(lv_ids)
    if not doc_id:
        raise ValueError("Aucun document de signature à renvoyer.")
    ok = documenso.resend_document(doc_id)
    if ok:
        db.query("UPDATE bon.lettres_voiture SET signature_sent_at = now() WHERE id = ANY(%s)",
                 (list(lv_ids),))
    return {"resent": ok, "document_id": doc_id}
