#!/usr/bin/env python3
"""Captures responsive + contrôle « pas de scroll horizontal » (Playwright, CI).

Front servi en statique, ouvert en MODE DÉMO (?demo=1 : pas d'auth, données
fictives). Deep-links : ?screen=<route>, ?theme=clair|sombre, ?role=bureau|chauffeur.

Captures : iPhone 15 Pro (393x852, DSR 3, UA Safari iOS 26) en rôle bureau ET
chauffeur, iPad, ordinateur 1440. Sortie : screenshots/ (artefact CI).

Sort en échec (exit 1) si un écran mobile déborde horizontalement.
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080/index.html"
OUT = Path("screenshots")
OUT.mkdir(exist_ok=True)

IOS26_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
)
IPHONE = {"width": 393, "height": 852}
IPAD = {"width": 834, "height": 1112}
DESKTOP = {"width": 1440, "height": 900}

# (route démo, libellé)
BUREAU_SCREENS = [
    ("dashboard", "tableau-de-bord"), ("lv", "lv"), ("today", "lv-ouverte"),
    ("planning", "planning"), ("reglages", "reglages"),
]
CHAUFFEUR_SCREENS = [
    ("today", "aujourdhui"), ("mes-lv", "mes-lv"), ("reglages", "reglages"),
]

overflow_failures: list[str] = []
status_failures: list[str] = []
font_failures: list[str] = []
align_failures: list[str] = []

# Locale + fuseau forcés sur tous les contextes : dates en JJ/MM/AAAA et heures en
# 24 h (toformat FR), indépendamment du fuseau du runner CI.
LOCALE = {"locale": "fr-FR", "timezone_id": "Europe/Paris"}

# Codes bruts de bon.statut_lv : ne doivent JAMAIS s'afficher (on veut les
# libellés français, cf. assets/status-labels.js).
RAW_STATUS_CODES = [
    "preparee", "en_cours", "cloturee", "a_signer",
    "envoyee", "en_attente_signature", "signee", "facturee", "annulee",
]


def check_no_hscroll(page, label: str) -> None:
    data = page.evaluate(
        "() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth})"
    )
    if data["sw"] > data["iw"] + 1:
        overflow_failures.append(f"{label}: scrollWidth={data['sw']} > innerWidth={data['iw']}")


def check_no_raw_status(page, label: str) -> None:
    text = page.evaluate("() => document.body.innerText || ''")
    low = text.lower()
    import re
    for code in RAW_STATUS_CODES:
        if re.search(r"(?<![a-z])" + re.escape(code) + r"(?![a-z])", low):
            status_failures.append(f"{label}: code de statut brut affiché « {code} »")


def shoot(ctx, prefix, route, theme, label, *, role="", drawer=False, check=True):
    page = ctx.new_page()
    try:
        extra = f"&role={role}" if role else ""
        url = f"{BASE}?demo=1&screen={route}&theme={theme}{extra}"
        page.goto(url, wait_until="load")
        page.wait_for_timeout(500)
        if drawer:
            page.click("#btn-nav-more", timeout=3000)
            page.wait_for_timeout(300)
        out = OUT / f"{prefix}-{label}-{theme}.png"
        page.screenshot(path=str(out), full_page=False)
        print("  ", out)
        if check and not drawer:
            check_no_hscroll(page, f"{prefix}-{label}-{theme}")
        if not drawer:
            check_no_raw_status(page, f"{prefix}-{label}-{theme}")
    except Exception as exc:  # noqa: BLE001
        print(f"   !! {prefix}/{label}/{theme}: {exc}")
    finally:
        page.close()


def shoot_lv_modif(ctx, prefix: str) -> None:
    """LV ouverte AVANT (bouton Annuler masqué) puis APRÈS une modification
    (bouton Annuler visible)."""
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}?demo=1&screen=today&role=bureau&theme=clair", wait_until="load")
        page.wait_for_timeout(600)
        undo_before = page.locator("#btn-undo").is_hidden()
        page.screenshot(path=str(OUT / f"{prefix}-lv-avant-modif-clair.png"), full_page=False)
        print("   lv-avant-modif (undo masqué:", undo_before, ")")
        field = page.locator(
            "#view-today input[type='time'], #view-today input[type='text'], "
            "#view-today input[type='number']"
        ).first
        field.scroll_into_view_if_needed()
        field.click()
        field.fill("08:30")
        page.locator("h1").first.click()  # blur -> empile l'annulation
        page.wait_for_timeout(300)
        undo_after = page.locator("#btn-undo").is_visible()
        page.screenshot(path=str(OUT / f"{prefix}-lv-apres-modif-clair.png"), full_page=False)
        print("   lv-apres-modif (undo visible:", undo_after, ")")
    except Exception as exc:  # noqa: BLE001
        print(f"   !! lv-modif: {exc}")
    finally:
        page.close()


def shoot_signer(ctx, prefix: str) -> None:
    """Accueil chauffeur : 2 lettres cochées -> « Signer (2) » -> choix Sur place /
    Par mail (f)."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=mes-lv&role=chauffeur&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            boxes = page.locator("#mes-lv-list .lv-row-check input")
            # Deux lettres du même contact (démo : KER-03041 + KER-03042).
            boxes.nth(1).check()
            boxes.nth(2).check()
            page.wait_for_timeout(200)
            page.screenshot(path=str(OUT / f"{prefix}-accueil-signer-{theme}.png"), full_page=False)
            print(f"   accueil-signer-{theme}")
            page.click("#btn-signer")
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / f"{prefix}-choix-signature-{theme}.png"), full_page=False)
            print(f"   choix-signature-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! signer/{theme}: {exc}")
        finally:
            page.close()


def shoot_prestations(ctx, prefix: str) -> None:
    """Bloc « Prestations » (H) : formulaire chauffeur en pleine page (le bloc est
    AVANT les tours) en clair + sombre, et écran bureau « Prestations »."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            page.locator("#prestations-list .prestation-row").first.scroll_into_view_if_needed()
            page.wait_for_timeout(200)
            page.screenshot(path=str(OUT / f"{prefix}-formulaire-prestations-{theme}.png"), full_page=True)
            check_no_hscroll(page, f"{prefix}-formulaire-prestations-{theme}")
            print(f"   formulaire-prestations-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! prestations-form/{theme}: {exc}")
        finally:
            page.close()
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=prestations&role=bureau&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f"{prefix}-prestations-bureau-{theme}.png"), full_page=True)
            check_no_hscroll(page, f"{prefix}-prestations-bureau-{theme}")
            print(f"   prestations-bureau-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! prestations-bureau/{theme}: {exc}")
        finally:
            page.close()


def shoot_suppression(ctx, prefix: str) -> None:
    """Menu de suppression / annulation (beta.15) : lettre numérotée ouverte ->
    bouton corbeille -> feuille « Annuler la lettre » (motif Doublon/Erreur/Autre)."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            page.click("#btn-delete-lv", timeout=3000)
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / f"{prefix}-suppression-annulation-{theme}.png"), full_page=False)
            print(f"   suppression-annulation-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! suppression/{theme}: {exc}")
        finally:
            page.close()


def shoot_formulaire_heures(ctx, prefix: str) -> None:
    """Formulaire chauffeur pleine page : Date, Heures (2 créneaux), prestations,
    tours avec articles (beta.15)."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f"{prefix}-formulaire-heures-{theme}.png"), full_page=True)
            check_no_hscroll(page, f"{prefix}-formulaire-heures-{theme}")
            # Vue rapprochée (viewport) : les DEUX créneaux horaires visibles,
            # au-dessus de la barre de navigation fixe.
            page.locator(".field-heures label").first.scroll_into_view_if_needed()
            page.evaluate("() => window.scrollBy(0, -60)")
            page.wait_for_timeout(200)
            page.screenshot(path=str(OUT / f"{prefix}-heures-creneaux-{theme}.png"), full_page=False)
            print(f"   formulaire-heures-{theme} + heures-creneaux-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! formulaire-heures/{theme}: {exc}")
        finally:
            page.close()


def shoot_date_heures(ctx, prefix: str) -> None:
    """WebKit (Safari iOS) : régression beta.15 sur l'alignement des champs natifs
    Date / Heures. Manu (iPhone réel) voyait le texte collé en haut de la case et
    la case Date plus haute que les selects. On vérifie par getBoundingClientRect
    que la hauteur des champs date/heure == celle d'un select (écart < 2 px) et
    que le centrage vertical est bien en place (display:flex + align-items:center,
    valeur interne sans marge), puis on capture un gros plan Date + Heures
    (clair + sombre). WebKit uniquement : le bug n'existe pas sur Chromium."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(
                f"{BASE}?demo=1&screen=today&role=bureau&theme={theme}",
                wait_until="load",
            )
            page.wait_for_timeout(600)
            # Valeurs explicites pour que le texte natif soit visible sur la capture.
            page.evaluate(
                """() => {
                    const d = document.getElementById('f-date');
                    if (d) { d.value = '2026-11-12'; d.dispatchEvent(new Event('change', {bubbles:true})); }
                    const deb = document.querySelector('#view-today .f-creneau-debut');
                    const fin = document.querySelector('#view-today .f-creneau-fin');
                    if (deb) { deb.value = '07:00'; deb.dispatchEvent(new Event('change', {bubbles:true})); }
                    if (fin) { fin.value = '16:00'; fin.dispatchEvent(new Event('change', {bubbles:true})); }
                }"""
            )
            page.wait_for_timeout(200)
            metrics = page.evaluate(
                """() => {
                    const pick = (sel) => {
                        const el = document.querySelector(sel);
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        const cs = getComputedStyle(el);
                        return { h: r.height, display: cs.display, align: cs.alignItems };
                    };
                    return {
                        date: pick('#f-date'),
                        time: pick('#view-today .f-creneau-debut'),
                        select: pick('#f-camion'),
                    };
                }"""
            )
            d, t, s = metrics.get("date"), metrics.get("time"), metrics.get("select")
            if not (d and t and s):
                align_failures.append(f"date-heures-{theme}: champ introuvable {metrics}")
            else:
                if abs(d["h"] - s["h"]) >= 2:
                    align_failures.append(
                        f"date-heures-{theme}: hauteur Date {d['h']:.1f}px != select {s['h']:.1f}px"
                    )
                if abs(t["h"] - s["h"]) >= 2:
                    align_failures.append(
                        f"date-heures-{theme}: hauteur Heure {t['h']:.1f}px != select {s['h']:.1f}px"
                    )
                for name, m in (("Date", d), ("Heure", t)):
                    if m["display"] != "flex" or m["align"] != "center":
                        align_failures.append(
                            f"date-heures-{theme}: {name} non centré "
                            f"(display={m['display']}, align-items={m['align']})"
                        )
            # Gros plan Date + Heures (les deux premiers champs du formulaire).
            form = page.locator("#lv-header-form")
            form.scroll_into_view_if_needed()
            page.wait_for_timeout(200)
            out = OUT / f"{prefix}-date-heures-{theme}.png"
            form.screenshot(path=str(out))
            print(f"   date-heures-{theme} (Date {d['h']:.0f}px / Heure {t['h']:.0f}px / select {s['h']:.0f}px)"
                  if (d and t and s) else f"   date-heures-{theme} (métriques incomplètes)")
        except Exception as exc:  # noqa: BLE001
            align_failures.append(f"date-heures-{theme}: exception {exc}")
            print(f"   !! date-heures/{theme}: {exc}")
        finally:
            page.close()


def shoot_logo(ctx, prefix: str) -> None:
    """Régression iPhone : le logo KERLAM de l'en-tête doit être rendu en Sarpanch
    (police chargée), pas en police système. On vérifie via document.fonts.check +
    getComputedStyle, et on capture un GROS PLAN du logo (clair + sombre)."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(
                f"{BASE}?demo=1&screen=dashboard&role=bureau&theme={theme}",
                wait_until="load",
            )
            page.wait_for_timeout(500)
            logo = page.locator(".topbar .logo").first
            logo.scroll_into_view_if_needed()
            info = page.evaluate(
                """async () => {
                    await document.fonts.ready;
                    try { await document.fonts.load('900 40px "Sarpanch"'); } catch (e) {}
                    const loaded = document.fonts.check('900 40px "Sarpanch"');
                    const el = document.querySelector('.topbar .logo');
                    const fam = el ? getComputedStyle(el).fontFamily : '';
                    return { loaded, fam };
                }"""
            )
            fam = info.get("fam") or ""
            if not info.get("loaded"):
                font_failures.append(
                    f"logo-{theme}: police Sarpanch non chargée (document.fonts.check=false)"
                )
            if "sarpanch" not in fam.lower():
                font_failures.append(
                    f"logo-{theme}: font-family calculée « {fam} » n'utilise pas Sarpanch"
                )
            out = OUT / f"{prefix}-logo-sarpanch-{theme}.png"
            logo.screenshot(path=str(out))
            print(f"   logo-sarpanch-{theme} (chargée: {info.get('loaded')}, famille: {fam[:32]})")
        except Exception as exc:  # noqa: BLE001
            font_failures.append(f"logo-{theme}: exception {exc}")
            print(f"   !! logo/{theme}: {exc}")
        finally:
            page.close()


def shoot_login(ctx, prefix: str) -> None:
    """Écran de connexion (#screen-login) : logo KERLAM en Sarpanch + choix de
    méthode. Le mode démo court-circuite l'auth : on révèle l'écran de connexion
    (markup statique) directement par le DOM pour la capture."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&theme={theme}", wait_until="load")
            page.wait_for_timeout(400)
            page.evaluate(
                """() => {
                    document.getElementById('app-shell').hidden = true;
                    document.getElementById('screen-unauthorized').hidden = true;
                    const login = document.getElementById('screen-login');
                    login.hidden = false;
                    const choice = document.getElementById('login-choice');
                    if (choice) choice.hidden = false;
                }"""
            )
            page.wait_for_timeout(200)
            page.screenshot(path=str(OUT / f"{prefix}-connexion-{theme}.png"), full_page=False)
            check_no_hscroll(page, f"{prefix}-connexion-{theme}")
            print(f"   connexion-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! connexion/{theme}: {exc}")
        finally:
            page.close()


def shoot_combobox(ctx, prefix: str) -> None:
    """beta.17 : champ de recherche Client avec liste ouverte filtrée (« jean » ->
    EJL via alias) + ligne « + Créer », et fiche rapide client (bottom sheet)."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            # Ouvre le combobox Client et tape « jean » -> liste filtrée + « + Créer ».
            page.evaluate(
                """() => {
                  const sel = document.getElementById('f-client');
                  const input = sel.parentNode.querySelector('.cb-input');
                  input.scrollIntoView({block:'center'});
                  input.focus();
                  input.value = 'jean';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                }"""
            )
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / f"{prefix}-combobox-client-{theme}.png"), full_page=False)
            check_no_hscroll(page, f"{prefix}-combobox-client-{theme}")
            print(f"   combobox-client-{theme}")
            # Clique « + Créer » -> fiche rapide client pré-remplie.
            page.evaluate(
                """() => {
                  const sel = document.getElementById('f-client');
                  const opt = Array.from(sel.parentNode.querySelectorAll('.cb-option'))
                    .find(o => o.classList.contains('cb-create'));
                  if (opt) opt.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
                }"""
            )
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / f"{prefix}-fiche-rapide-client-{theme}.png"), full_page=False)
            check_no_hscroll(page, f"{prefix}-fiche-rapide-client-{theme}")
            print(f"   fiche-rapide-client-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! combobox/{theme}: {exc}")
        finally:
            page.close()
    # Écran bureau Clients (même recherche + bouton Nouveau).
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=clients&role=bureau&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f"{prefix}-clients-bureau-{theme}.png"), full_page=False)
            check_no_hscroll(page, f"{prefix}-clients-bureau-{theme}")
            print(f"   clients-bureau-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! clients-bureau/{theme}: {exc}")
        finally:
            page.close()


beta19_failures: list[str] = []
beta20_failures: list[str] = []


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        beta19_failures.append(msg)


def _open_create_sheet(page, select_id: str) -> None:
    """Ouvre le combobox `select_id`, déclenche sa ligne « + Créer » (champ vide),
    ce qui ouvre la fiche rapide par-dessus."""
    page.evaluate(
        """(id) => {
          const sel = document.getElementById(id);
          const input = sel.parentNode.querySelector('.cb-input');
          input.scrollIntoView({block:'center'}); input.focus();
          input.dispatchEvent(new Event('focus', {bubbles:true}));
        }""",
        select_id,
    )
    page.wait_for_timeout(250)
    page.evaluate(
        """(id) => {
          const sel = document.getElementById(id);
          const opt = Array.from(sel.parentNode.querySelectorAll('.cb-option'))
            .find(o => o.classList.contains('cb-create'));
          if (opt) opt.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
        }""",
        select_id,
    )
    page.wait_for_timeout(350)


def _sheet_sane(page, who: str) -> None:
    """Fiche rapide : visible, champs = simples <input> (pas de combobox imbriqué),
    libellés visibles, bouton Enregistrer présent."""
    info = page.evaluate(
        """() => {
          const sheet = document.getElementById('quick-create-sheet');
          const body = document.getElementById('quick-create-body');
          const inputs = body ? body.querySelectorAll('input') : [];
          const nestedCb = body ? body.querySelectorAll('.cb-input, .combobox').length : -1;
          const labels = body ? body.querySelectorAll('.field label').length : 0;
          const save = document.getElementById('btn-quick-create-save');
          const title = (document.getElementById('quick-create-title')||{}).textContent || '';
          return { open: sheet && !sheet.hidden, n: inputs.length, nestedCb, labels,
                   save: !!save, title: title.trim() };
        }"""
    )
    _assert(info["open"], f"{who}: la fiche rapide ne s'ouvre pas")
    _assert(info["nestedCb"] == 0, f"{who}: combobox imbriqué dans la fiche ({info['nestedCb']})")
    _assert(info["n"] >= 1, f"{who}: aucun champ texte dans la fiche")
    _assert(info["labels"] >= info["n"], f"{who}: libellés manquants ({info['labels']}/{info['n']})")
    _assert(info["save"], f"{who}: bouton Enregistrer absent")


def shoot_beta20_fiches(ctx, prefix: str) -> None:
    """beta.20 (WebKit, DSR 2) : fiches rapides SANS bouton « Enregistrer »
    (enregistrement en temps réel). En-tête titre + ✕ ; la fiche est créée dès la
    1re saisie (indicateur « Enregistré ») ; champ obligatoire manquant en rouge ;
    aucun dialogue « Abandonner ? ». Captures clair + sombre + assertions E2E."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=bureau&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            # Un client doit être choisi avant de créer un contact.
            page.evaluate(
                """() => {
                  const sel = document.getElementById('f-client');
                  if (sel && sel.options.length > 1) {
                    sel.selectedIndex = 1;
                    sel.dispatchEvent(new Event('change', {bubbles:true}));
                  }
                }"""
            )
            page.wait_for_timeout(200)

            # Aide « Contact signataire » portée par l'infobulle ⓘ.
            lab = page.evaluate(
                """() => {
                  const l = document.querySelector('label[for="f-contact"]');
                  const row = l ? l.closest('.tt-row') : null;
                  const bubble = row ? row.parentElement.querySelector('.tt-bubble') : null;
                  return { label: l ? l.textContent.trim() : '', help: bubble ? bubble.textContent.trim() : '' };
                }"""
            )
            _assert(lab["label"] == "Contact signataire", f"label contact = {lab['label']!r}")
            _assert("Signe les lettres de voiture" in lab["help"], "aide contact (infobulle) absente")

            # Ouvre « Nouveau contact signataire » (combobox + Créer).
            _open_create_sheet(page, "f-contact")
            _sheet_sane(page, f"contact/{theme}")
            title = page.evaluate("() => document.getElementById('quick-create-title').textContent.trim()")
            _assert("contact signataire" in title.lower(), f"titre fiche contact = {title!r}")

            # AUCUN bouton « Enregistrer » dans la fiche (enregistrement en temps réel).
            no_save = page.evaluate(
                """() => !document.getElementById('btn-quick-create-save')
                        && !document.getElementById('btn-quick-create-save-top')
                        && !document.querySelector('#quick-create-sheet button[type=submit]')"""
            )
            _assert(no_save, "un bouton « Enregistrer » subsiste dans la fiche")

            # Autosave : saisir le nom -> indicateur « Enregistré ».
            page.evaluate(
                """() => {
                  const n = document.querySelector('#quick-create-body input');
                  n.value = 'Franck Durand';
                  n.dispatchEvent(new Event('input', {bubbles:true}));
                }"""
            )
            page.wait_for_timeout(900)
            saved = page.evaluate(
                """() => { const s = document.getElementById('quick-create-status');
                           return s && !s.hidden && /Enregistr/i.test(s.textContent || ''); }"""
            )
            _assert(saved, "indicateur « Enregistré » absent après la saisie du nom")

            # E-mail obligatoire manquant -> champ en ROUGE + message court sous le champ.
            page.evaluate(
                """() => { const em = document.querySelector('#quick-create-body input[type=email]');
                           if (em) { em.focus(); em.blur(); } }"""
            )
            page.wait_for_timeout(250)
            red = page.evaluate(
                """() => {
                  const em = document.querySelector('#quick-create-body input[type=email]');
                  const p = em ? em.parentElement.querySelector('.field-error-inline') : null;
                  return { red: !!(em && em.classList.contains('field-invalid')),
                           msg: p ? p.textContent.trim() : '' };
                }"""
            )
            _assert(red["red"], "champ e-mail non marqué en rouge quand vide")
            _assert("manquant" in red["msg"].lower(), f"message e-mail manquant = {red['msg']!r}")
            page.screenshot(path=str(OUT / f"{prefix}-nouveau-contact-{theme}.png"), full_page=False)
            print(f"   nouveau-contact-{theme}")

            # Clavier iOS simulé : titre + ✕ restent dans le viewport visible.
            page.evaluate(
                """(h) => {
                  if (!window.visualViewport) return;
                  try { Object.defineProperty(window.visualViewport, 'height',
                    { configurable: true, get: () => h }); } catch (e) {}
                  try { Object.defineProperty(window.visualViewport, 'offsetTop',
                    { configurable: true, get: () => 0 }); } catch (e) {}
                  window.visualViewport.dispatchEvent(new Event('resize'));
                }""",
                430,
            )
            page.wait_for_timeout(200)
            hdr = page.evaluate(
                """(vvh) => {
                  const inv = (el) => { if (!el) return false;
                    const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vvh; };
                  return { title: inv(document.getElementById('quick-create-title')),
                           close: inv(document.getElementById('btn-quick-create-close')) };
                }""",
                430,
            )
            _assert(hdr["title"] and hdr["close"], "titre/✕ hors du viewport clavier")
            page.screenshot(path=str(OUT / f"{prefix}-nouveau-contact-clavier-{theme}.png"), full_page=False)
            print(f"   nouveau-contact-clavier-{theme}")

            # Ferme via ✕ (aucun dialogue « Abandonner ? » : la fiche reste enregistrée).
            page.evaluate("() => document.getElementById('btn-quick-create-close').click()")
            page.wait_for_timeout(300)
            closed = page.evaluate("() => document.getElementById('quick-create-sheet').hidden")
            _assert(closed, "la fiche ne se ferme pas sur ✕")

            # --- Modifier le client (édition) : crayon -> fiche pré-remplie, titre « Modifier ».
            page.evaluate(
                """() => {
                  const sel = document.getElementById('f-client');
                  const cb = sel.parentNode.querySelector('.cb-edit');
                  if (cb) cb.click();
                }"""
            )
            page.wait_for_timeout(350)
            _sheet_sane(page, f"client-edit/{theme}")
            filled = page.evaluate(
                """() => {
                  const b = document.getElementById('quick-create-body');
                  const first = b.querySelector('input');
                  const t = document.getElementById('quick-create-title').textContent.trim();
                  return { t, v: first ? first.value : '' };
                }"""
            )
            _assert(filled["t"].lower().startswith("modifier"), f"titre édition client = {filled['t']!r}")
            _assert(len(filled["v"]) > 0, "fiche édition client non pré-remplie")
            page.screenshot(path=str(OUT / f"{prefix}-modifier-client-{theme}.png"), full_page=False)
            print(f"   modifier-client-{theme}")
            page.evaluate("() => document.getElementById('btn-quick-create-close').click()")
            page.wait_for_timeout(200)
        except Exception as exc:  # noqa: BLE001
            beta20_failures.append(f"fiches/{theme}: {exc}")
            print(f"   !! fiches/{theme}: {exc}")
        finally:
            page.close()


def shoot_beta20_infobulles(ctx, prefix: str) -> None:
    """beta.20 (WebKit, DSR 2) : infobulles ⓘ sur les champs du formulaire.

    Vérifie, en clair ET en sombre : l'icône ⓘ est présente ; un toucher ouvre la
    bulle Date (texte « Jour du transport. ») SANS recouvrir le champ Date ; un
    toucher ailleurs la ferme ; la bulle Destinataire s'ouvre de même. Captures :
    formulaire avec ⓘ, bulle Date ouverte, bulle Destinataire ouverte, et fiche
    rapide contact avec ⓘ.
    """
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=bureau&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)

            n_icons = page.locator(".tt-btn").count()
            if n_icons < 5:
                beta20_failures.append(f"infobulles/{theme}: seulement {n_icons} icône(s) ⓘ (attendu ≥ 5)")

            form = page.locator("#lv-header-form")
            form.scroll_into_view_if_needed()
            page.wait_for_timeout(150)
            page.screenshot(path=str(OUT / f"{prefix}-infobulles-formulaire-{theme}.png"), full_page=False)

            # --- Bulle Date : ouvre, vérifie le texte + le non-chevauchement du champ.
            date_btn = page.locator('.tt-row:has(label[data-tt="date"]) .tt-btn')
            date_btn.click()
            page.wait_for_timeout(200)
            bubble = page.locator('.tt-bubble:not([hidden])').first
            if bubble.count() == 0 or not bubble.is_visible():
                beta20_failures.append(f"infobulles/{theme}: bulle Date non ouverte")
            else:
                txt = (bubble.inner_text() or "").strip()
                if txt != "Jour du transport.":
                    beta20_failures.append(f"infobulles/{theme}: texte Date = {txt!r} (attendu « Jour du transport. »)")
                boxes = page.evaluate(
                    """() => {
                        const b = document.querySelector('.tt-bubble:not([hidden])');
                        const f = document.getElementById('f-date');
                        if (!b || !f) return null;
                        const rb = b.getBoundingClientRect();
                        const rf = f.getBoundingClientRect();
                        const overlap = !(rb.bottom <= rf.top || rb.top >= rf.bottom
                                          || rb.right <= rf.left || rb.left >= rf.right);
                        return { overlap };
                    }"""
                )
                if not boxes:
                    beta20_failures.append(f"infobulles/{theme}: bulle/champ Date introuvable")
                elif boxes["overlap"]:
                    beta20_failures.append(f"infobulles/{theme}: la bulle Date recouvre le champ Date")
            page.screenshot(path=str(OUT / f"{prefix}-infobulle-date-{theme}.png"), full_page=False)

            # --- Toucher ailleurs = fermeture.
            page.locator("h1").first.click()
            page.wait_for_timeout(150)
            if page.locator('.tt-bubble:not([hidden])').count() != 0:
                beta20_failures.append(f"infobulles/{theme}: la bulle reste ouverte après un toucher ailleurs")

            # --- Bulle Destinataire.
            dest_btn = page.locator('.tt-row:has(label[data-tt="destinataire"]) .tt-btn')
            dest_btn.scroll_into_view_if_needed()
            dest_btn.click()
            page.wait_for_timeout(200)
            if page.locator('.tt-bubble:not([hidden])').count() == 0:
                beta20_failures.append(f"infobulles/{theme}: bulle Destinataire non ouverte")
            page.screenshot(path=str(OUT / f"{prefix}-infobulle-destinataire-{theme}.png"), full_page=False)
            check_no_hscroll(page, f"infobulles-{theme}")

            # --- Champ « Quantité estimée de la journée » (beta.20) : capture + ⓘ présent.
            qrow = page.locator('.tt-row:has(label[data-tt="quantite_estimee"])')
            if qrow.count() == 0:
                beta20_failures.append(f"quantite-estimee/{theme}: libellé/infobulle absent du formulaire")
            else:
                qrow.scroll_into_view_if_needed()
                page.wait_for_timeout(150)
                page.screenshot(path=str(OUT / f"{prefix}-quantite-estimee-{theme}.png"), full_page=False)
            print(f"   infobulles-{theme} ({n_icons} icônes ⓘ)")
        except Exception as exc:  # noqa: BLE001
            beta20_failures.append(f"infobulles/{theme}: {exc}")
            print(f"   !! infobulles/{theme}: {exc}")
        finally:
            page.close()

    # --- Fiche rapide contact : ⓘ sur l'e-mail (clair).
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme=clair", wait_until="load")
        page.wait_for_timeout(600)
        # Choisir un client (prérequis de la fiche contact) puis ouvrir la fiche.
        page.evaluate(
            """() => {
                const c = document.getElementById('f-client');
                if (c && c.options.length > 1) {
                    c.selectedIndex = 1;
                    c.dispatchEvent(new Event('change', {bubbles:true}));
                }
            }"""
        )
        page.wait_for_timeout(200)
        page.evaluate("() => window.openQuickCreate && window.openQuickCreate('contact', 'Jean Dupont')")
        page.wait_for_timeout(400)
        opened = page.evaluate(
            "() => { const s = document.getElementById('quick-create-sheet'); return s && !s.hidden; }"
        )
        has_icon = page.locator('#quick-create-body .tt-btn').count()
        if not opened:
            beta20_failures.append("infobulles/fiche-contact: fiche non ouverte")
        elif has_icon < 1:
            beta20_failures.append("infobulles/fiche-contact: aucune icône ⓘ dans la fiche contact")
        page.screenshot(path=str(OUT / f"{prefix}-infobulle-fiche-contact-clair.png"), full_page=False)
        print(f"   infobulle-fiche-contact-clair ({has_icon} icône(s) ⓘ)")
    except Exception as exc:  # noqa: BLE001
        beta20_failures.append(f"infobulles/fiche-contact: {exc}")
        print(f"   !! infobulles/fiche-contact: {exc}")
    finally:
        page.close()


def shoot_beta20_fiche_clavier(ctx, prefix: str) -> None:
    """beta.20 (WebKit, DSR 2) — PRIORITÉ : fiche « Nouveau contact signataire » en
    vue PLEIN ÉCRAN modale, clavier iOS simulé (visualViewport réduit + scroll page).

    Vérifie, clair ET sombre : le titre et le bouton « Enregistrer » (en-tête) restent
    DANS le viewport visible ; et aucun élément de la lettre n'est visible derrière la
    fiche (elementFromPoint sur plusieurs points tombe toujours dans #quick-create-sheet).
    """
    VVH = 430
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            # Choisir un client (prérequis du contact) puis ouvrir la fiche contact.
            page.evaluate(
                """() => {
                    const c = document.getElementById('f-client');
                    if (c && c.options.length > 1) {
                        c.selectedIndex = 1;
                        c.dispatchEvent(new Event('change', {bubbles:true}));
                    }
                }"""
            )
            page.wait_for_timeout(200)
            page.evaluate("() => window.openQuickCreate && window.openQuickCreate('contact', 'Jean Dupont')")
            page.wait_for_timeout(400)
            # Clavier iOS simulé : visualViewport réduit + tentative de scroll de la page.
            page.evaluate(
                """(h) => {
                    window.scrollTo(0, 500);
                    if (window.visualViewport) {
                        try {
                            Object.defineProperty(window.visualViewport, 'height',
                                { configurable: true, get: () => h });
                        } catch (e) {}
                        try {
                            Object.defineProperty(window.visualViewport, 'offsetTop',
                                { configurable: true, get: () => 0 });
                        } catch (e) {}
                        window.visualViewport.dispatchEvent(new Event('resize'));
                    }
                }""",
                VVH,
            )
            page.wait_for_timeout(250)
            checks = page.evaluate(
                """(vvh) => {
                    const inView = (el) => {
                        if (!el) return false;
                        const r = el.getBoundingClientRect();
                        return r.top >= 0 && r.bottom <= vvh && r.width > 0 && r.height > 0;
                    };
                    const title = document.getElementById('quick-create-title');
                    const saveTop = document.getElementById('btn-quick-create-save-top');
                    // Points répartis dans le viewport visible : tous doivent tomber DANS la fiche.
                    const pts = [[196, 60], [196, 200], [196, 320], [196, vvh - 12], [30, 150], [360, 260]];
                    let leaks = 0;
                    for (const [x, y] of pts) {
                        const el = document.elementFromPoint(x, y);
                        if (!el || !el.closest('#quick-create-sheet')) leaks++;
                    }
                    return { title: inView(title), save: inView(saveTop), leaks };
                }""",
                VVH,
            )
            if not checks["title"]:
                beta20_failures.append(f"fiche-clavier/{theme}: titre hors du viewport visible")
            if not checks["save"]:
                beta20_failures.append(f"fiche-clavier/{theme}: bouton Enregistrer hors du viewport visible")
            if checks["leaks"]:
                beta20_failures.append(
                    f"fiche-clavier/{theme}: {checks['leaks']} point(s) laissent voir la lettre derrière la fiche"
                )
            page.screenshot(path=str(OUT / f"{prefix}-fiche-contact-clavier-{theme}.png"), full_page=False)
            print(f"   fiche-contact-clavier-{theme} "
                  f"(titre={checks['title']}, save={checks['save']}, leaks={checks['leaks']})")
        except Exception as exc:  # noqa: BLE001
            beta20_failures.append(f"fiche-clavier/{theme}: {exc}")
            print(f"   !! fiche-clavier/{theme}: {exc}")
        finally:
            page.close()


def shoot_beta20_completeness(ctx, prefix: str) -> None:
    """beta.20 : bandeau « N éléments à compléter avant signature » déplié sur une
    lettre incomplète (on vide la date pour forcer un manque), clair + sombre."""
    for theme in ("clair", "sombre"):
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}?demo=1&screen=today&role=bureau&theme={theme}", wait_until="load")
            page.wait_for_timeout(600)
            # Force un manque : on vide la date (mention obligatoire).
            page.evaluate(
                """() => { const d = document.getElementById('f-date');
                           if (d) { d.value = ''; d.dispatchEvent(new Event('change', {bubbles:true})); } }"""
            )
            page.wait_for_timeout(400)
            shown = page.evaluate(
                "() => { const b = document.getElementById('lv-completeness'); return b && !b.hidden; }")
            if not shown:
                beta20_failures.append(f"completude/{theme}: bandeau absent sur lettre incomplète")
            page.evaluate("() => { const t = document.getElementById('lvc-toggle'); if (t) t.click(); }")
            page.wait_for_timeout(300)
            expanded = page.evaluate(
                """() => { const l = document.getElementById('lvc-list');
                           return l && !l.hidden && l.querySelectorAll('.lvc-item').length > 0; }"""
            )
            if not expanded:
                beta20_failures.append(f"completude/{theme}: liste non dépliée")
            red = page.evaluate("() => !!document.querySelector('#view-today .field-missing')")
            if not red:
                beta20_failures.append(f"completude/{theme}: aucune mention obligatoire en rouge")
            page.locator("#lv-completeness").scroll_into_view_if_needed()
            page.wait_for_timeout(150)
            page.screenshot(path=str(OUT / f"{prefix}-a-completer-{theme}.png"), full_page=False)
            print(f"   a-completer-{theme} (bandeau={shown}, déplié={expanded}, rouge={red})")
        except Exception as exc:  # noqa: BLE001
            beta20_failures.append(f"completude/{theme}: {exc}")
            print(f"   !! completude/{theme}: {exc}")
        finally:
            page.close()


def shoot_beta20_bureau_filter(ctx, prefix: str) -> None:
    """beta.20 : filtre « À compléter » sur l'écran bureau Clients (clair)."""
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}?demo=1&screen=clients&role=bureau&theme=clair", wait_until="load")
        page.wait_for_timeout(600)
        present = page.evaluate("() => !!document.getElementById('filter-clients-incomplete')")
        if not present:
            beta20_failures.append("filtre-bureau: case « À compléter » absente")
        page.evaluate(
            """() => { const c = document.getElementById('filter-clients-incomplete');
                       if (c) { c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); } }"""
        )
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"{prefix}-bureau-a-completer-clair.png"), full_page=False)
        print(f"   bureau-a-completer-clair (case présente={present})")
    except Exception as exc:  # noqa: BLE001
        beta20_failures.append(f"filtre-bureau: {exc}")
        print(f"   !! filtre-bureau: {exc}")
    finally:
        page.close()


def main() -> int:
    with sync_playwright() as p:
        # --lang=fr-FR : les contrôles natifs <input type="date"|"time"> suivent la
        # langue de l'UI du navigateur (pas la `locale` du contexte) ; sans ça les
        # dates sortaient en MM/JJ/AAAA et les heures en AM/PM. Le fuseau et le
        # formatage Intl restent fixés par locale/timezone_id sur chaque contexte.
        browser = p.chromium.launch(args=["--lang=fr-FR"])
        iphone = browser.new_context(
            viewport=IPHONE, device_scale_factor=3, is_mobile=True, has_touch=True,
            user_agent=IOS26_UA, **LOCALE,
        )
        iphone.set_default_timeout(8000)
        iphone.set_default_navigation_timeout(20000)
        # Logo KERLAM : vérifie que la police Sarpanch est bien chargée et appliquée
        # (régression iPhone : le logo retombait en police système) + gros plan.
        shoot_logo(iphone, "iphone")
        shoot_login(iphone, "iphone")
        # Bureau (cas de Manu) : clair + sombre sur le tableau de bord et une LV.
        for route, label in BUREAU_SCREENS:
            shoot(iphone, "iphone-bureau", route, "clair", label, role="bureau")
        shoot(iphone, "iphone-bureau", "dashboard", "sombre", "tableau-de-bord", role="bureau")
        shoot(iphone, "iphone-bureau", "today", "sombre", "lv-ouverte", role="bureau")
        shoot(iphone, "iphone-bureau", "dashboard", "clair", "menu-plus", role="bureau", drawer=True)
        shoot(iphone, "iphone-bureau", "dashboard", "sombre", "menu-plus", role="bureau", drawer=True)
        shoot_lv_modif(iphone, "iphone-bureau")
        # Chauffeur.
        for route, label in CHAUFFEUR_SCREENS:
            shoot(iphone, "iphone-chauffeur", route, "clair", label, role="chauffeur")
        shoot(iphone, "iphone-chauffeur", "today", "sombre", "aujourdhui", role="chauffeur")
        shoot_signer(iphone, "iphone-chauffeur")
        shoot_prestations(iphone, "iphone")
        shoot_formulaire_heures(iphone, "iphone-chauffeur")
        shoot_suppression(iphone, "iphone-chauffeur")
        shoot_combobox(iphone, "iphone")
        iphone.close()

        ipad = browser.new_context(viewport=IPAD, device_scale_factor=2, is_mobile=True, has_touch=True, **LOCALE)
        ipad.set_default_timeout(8000)
        ipad.set_default_navigation_timeout(20000)
        shoot(ipad, "ipad", "dashboard", "clair", "tableau-de-bord", role="bureau")
        ipad.close()

        desktop = browser.new_context(viewport=DESKTOP, **LOCALE)
        desktop.set_default_timeout(8000)
        desktop.set_default_navigation_timeout(20000)
        shoot(desktop, "bureau", "dashboard", "clair", "tableau-de-bord", check=False)
        shoot(desktop, "bureau", "chauffeurs", "clair", "chauffeurs", check=False)
        desktop.close()

        # Page /installer/ (mobile iOS 26).
        inst = browser.new_context(
            viewport=IPHONE, device_scale_factor=3, is_mobile=True,
            has_touch=True, user_agent=IOS26_UA, **LOCALE,
        )
        inst.set_default_timeout(8000)
        inst.set_default_navigation_timeout(20000)
        ip = inst.new_page()
        try:
            ip.goto(BASE.replace("index.html", "") + "installer/", wait_until="load")
            ip.wait_for_timeout(500)
            ip.screenshot(path=str(OUT / "iphone-installer-clair.png"), full_page=True)
            check_no_hscroll(ip, "installer")
            print("   installer ok")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! installer: {exc}")
        inst.close()
        browser.close()

        # --- WebKit (moteur de Safari iOS) : vérification ciblée de l'alignement
        # des champs natifs Date / Heures, que Chromium ne reproduit pas. Locale
        # fr-FR + Europe/Paris sur le contexte (WebKit suit la locale du contexte
        # pour les contrôles natifs, pas besoin du flag --lang). UA iPhone iOS 26.
        wk = p.webkit.launch()
        # is_mobile n'est pas supporté par WebKit (option Chromium) : on l'omet.
        wk_iphone = wk.new_context(
            viewport=IPHONE, device_scale_factor=3, has_touch=True,
            user_agent=IOS26_UA, **LOCALE,
        )
        wk_iphone.set_default_timeout(8000)
        wk_iphone.set_default_navigation_timeout(20000)
        print("WebKit (Safari iOS) : alignement Date / Heures")
        shoot_date_heures(wk_iphone, "webkit-iphone")
        wk_iphone.close()

        # beta.19 : fiches rapides (champs texte propres, clavier iOS, e-mail requis,
        # « Contact signataire ») — WebKit, deviceScaleFactor 2, clair + sombre.
        wk_iphone2 = wk.new_context(
            viewport=IPHONE, device_scale_factor=2, has_touch=True,
            user_agent=IOS26_UA, **LOCALE,
        )
        wk_iphone2.set_default_timeout(8000)
        wk_iphone2.set_default_navigation_timeout(20000)
        print("WebKit (Safari iOS, DSR 2) : fiches rapides autosave beta.20")
        shoot_beta20_fiches(wk_iphone2, "webkit-iphone")
        print("WebKit (Safari iOS, DSR 2) : fiche plein écran + clavier beta.20")
        shoot_beta20_fiche_clavier(wk_iphone2, "webkit-iphone")
        print("WebKit (Safari iOS, DSR 2) : infobulles ⓘ beta.20")
        shoot_beta20_infobulles(wk_iphone2, "webkit-iphone")
        print("WebKit (Safari iOS, DSR 2) : bandeau complétude beta.20")
        shoot_beta20_completeness(wk_iphone2, "webkit-iphone")
        print("WebKit (Safari iOS, DSR 2) : filtre bureau À compléter beta.20")
        shoot_beta20_bureau_filter(wk_iphone2, "webkit-iphone")
        wk_iphone2.close()
        wk.close()

    n = len(list(OUT.glob("*.png")))
    print(f"{n} captures dans {OUT}/")
    rc = 0
    if overflow_failures:
        print("DÉBORDEMENT HORIZONTAL détecté :")
        for f in overflow_failures:
            print("  -", f)
        rc = 1
    else:
        print("OK : aucun débordement horizontal.")
    if status_failures:
        print("CODE DE STATUT BRUT AFFICHÉ (utiliser un libellé français) :")
        for f in status_failures:
            print("  -", f)
        rc = 1
    else:
        print("OK : aucun code de statut brut affiché.")
    if font_failures:
        print("LOGO NON RENDU EN SARPANCH (police du logo cassée) :")
        for f in font_failures:
            print("  -", f)
        rc = 1
    else:
        print("OK : logo rendu en Sarpanch (police chargée).")
    if align_failures:
        print("CHAMPS DATE / HEURES MAL ALIGNÉS (WebKit / Safari iOS) :")
        for f in align_failures:
            print("  -", f)
        rc = 1
    else:
        print("OK : champs Date / Heures alignés comme les selects (WebKit).")
    if beta19_failures:
        print("FICHES RAPIDES beta.19 KO (champs / clavier / e-mail / libellé) :")
        for f in beta19_failures:
            print("  -", f)
        rc = 1
    else:
        print("OK : fiches rapides beta.19 (champs texte, clavier, e-mail, Contact signataire).")
    if beta20_failures:
        print("INFOBULLES beta.20 KO (icône / ouverture / texte Date / chevauchement) :")
        for f in beta20_failures:
            print("  -", f)
        rc = 1
    else:
        print("OK : infobulles beta.20 (icône ⓘ, bulle Date « Jour du transport. », pas de chevauchement).")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
