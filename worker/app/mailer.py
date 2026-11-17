"""Envoi d'e-mail du worker (SMTP) — beta.25.

Unique usage : après signature complète, envoyer AU NOM DE KERLAM un seul mail au
contact signataire (KERLAM en copie si configurée) avec le PDF signé en pièce
jointe. Les identifiants SMTP sont lus dans l'environnement (cf. config.Settings),
jamais journalisés. Best-effort : renvoie True/False sans lever.
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from .config import settings


def is_configured() -> bool:
    """Vrai si un serveur SMTP exploitable est configuré."""
    return bool(settings.smtp_host)


def send_mail(
    to: str,
    subject: str,
    body: str,
    *,
    attachment: tuple[str, bytes, str] | None = None,
) -> bool:
    """Envoie un mail texte avec pièce jointe optionnelle (nom, données, mime).
    KERLAM (settings.kerlam_contact_email) est mis en copie s'il est défini et
    différent du destinataire. Renvoie True si l'envoi a abouti, False sinon."""
    if not is_configured() or not to:
        return False

    msg = EmailMessage()
    msg["From"] = formataddr((settings.smtp_from_name or "KERLAM", settings.smtp_from))
    msg["To"] = to
    cc = (settings.kerlam_contact_email or "").strip()
    if cc and cc.lower() != to.strip().lower():
        msg["Cc"] = cc
    msg["Subject"] = subject
    msg.set_content(body)

    if attachment:
        name, data, mime = attachment
        maintype, _, subtype = (mime or "application/octet-stream").partition("/")
        msg.add_attachment(data, maintype=maintype, subtype=subtype or "octet-stream", filename=name)

    recipients = [to] + ([cc] if "Cc" in msg else [])
    try:
        if int(settings.smtp_port) == 465:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30) as s:
                _auth_and_send(s, msg, recipients)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as s:
                s.ehlo()
                try:
                    s.starttls()
                    s.ehlo()
                except smtplib.SMTPException:
                    pass  # serveur sans STARTTLS (relais interne de la pile)
                _auth_and_send(s, msg, recipients)
        return True
    except Exception:  # noqa: BLE001
        return False


def _auth_and_send(s: smtplib.SMTP, msg: EmailMessage, recipients: list[str]) -> None:
    if settings.smtp_user and settings.smtp_password:
        s.login(settings.smtp_user, settings.smtp_password)
    s.send_message(msg, from_addr=settings.smtp_from, to_addrs=recipients)
