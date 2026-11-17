"""Mailer (beta.26) : le mail unique des lettres signées met contact@kerlam.fr en
copie (Cc), sans jamais ouvrir de vraie connexion SMTP (smtplib mocké)."""

import smtplib

from app import mailer
from app.config import settings


class FakeSMTP:
    """SMTP factice : enregistre l'appel sans réseau. sent = capture partagée."""
    instances = []

    def __init__(self, host, port, timeout=0):
        self.host = host
        self.port = port
        self.sent = None
        self.logged_in = None
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def ehlo(self):
        pass

    def starttls(self):
        pass

    def login(self, user, password):
        self.logged_in = user

    def send_message(self, msg, from_addr=None, to_addrs=None):
        self.sent = {"msg": msg, "from_addr": from_addr, "to_addrs": to_addrs}


def _prime(monkeypatch, *, cc="contact@kerlam.fr"):
    FakeSMTP.instances = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_password", "")
    monkeypatch.setattr(settings, "smtp_from", "bon@kerlam.fr")
    monkeypatch.setattr(settings, "smtp_from_name", "KERLAM")
    monkeypatch.setattr(settings, "kerlam_contact_email", cc)


def test_cc_contact_kerlam_par_defaut(monkeypatch):
    _prime(monkeypatch)
    ok = mailer.send_mail(
        to="client@example.test", subject="Lettres de voiture signées : KER-1",
        body="corps", attachment=("x.pdf", b"%PDF", "application/pdf"),
    )
    assert ok is True
    s = FakeSMTP.instances[-1]
    assert s.sent is not None, "aucun envoi mocké capturé"
    msg = s.sent["msg"]
    assert msg["Cc"] == "contact@kerlam.fr"
    # Les deux destinataires (To + Cc) reçoivent effectivement l'enveloppe SMTP.
    assert set(s.sent["to_addrs"]) == {"client@example.test", "contact@kerlam.fr"}
    assert s.sent["from_addr"] == "bon@kerlam.fr"


def test_pas_de_cc_si_vide(monkeypatch):
    _prime(monkeypatch, cc="")
    mailer.send_mail(to="client@example.test", subject="s", body="b")
    s = FakeSMTP.instances[-1]
    assert s.sent["msg"]["Cc"] is None
    assert s.sent["to_addrs"] == ["client@example.test"]


def test_cc_ignore_si_identique_au_destinataire(monkeypatch):
    _prime(monkeypatch, cc="Contact@Kerlam.fr")
    mailer.send_mail(to="contact@kerlam.fr", subject="s", body="b")
    s = FakeSMTP.instances[-1]
    # Pas de doublon si le contact EST le destinataire (comparaison insensible à la casse).
    assert s.sent["msg"]["Cc"] is None
    assert s.sent["to_addrs"] == ["contact@kerlam.fr"]


def test_non_configure_n_envoie_rien(monkeypatch):
    FakeSMTP.instances = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "smtp_host", "")
    assert mailer.send_mail(to="client@example.test", subject="s", body="b") is False
    assert FakeSMTP.instances == [], "aucune connexion SMTP ne doit être ouverte"
