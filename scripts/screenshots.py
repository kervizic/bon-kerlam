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
        page.goto(url, wait_until="networkidle")
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
        page.goto(f"{BASE}?demo=1&screen=today&role=bureau&theme=clair", wait_until="networkidle")
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
            page.goto(f"{BASE}?demo=1&screen=mes-lv&role=chauffeur&theme={theme}", wait_until="networkidle")
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
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="networkidle")
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
            page.goto(f"{BASE}?demo=1&screen=prestations&role=bureau&theme={theme}", wait_until="networkidle")
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
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="networkidle")
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
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="networkidle")
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
                wait_until="networkidle",
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
                wait_until="networkidle",
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
            page.goto(f"{BASE}?demo=1&theme={theme}", wait_until="networkidle")
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
            page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme={theme}", wait_until="networkidle")
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
            page.goto(f"{BASE}?demo=1&screen=clients&role=bureau&theme={theme}", wait_until="networkidle")
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f"{prefix}-clients-bureau-{theme}.png"), full_page=False)
            check_no_hscroll(page, f"{prefix}-clients-bureau-{theme}")
            print(f"   clients-bureau-{theme}")
        except Exception as exc:  # noqa: BLE001
            print(f"   !! clients-bureau/{theme}: {exc}")
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
        shoot(ipad, "ipad", "dashboard", "clair", "tableau-de-bord", role="bureau")
        ipad.close()

        desktop = browser.new_context(viewport=DESKTOP, **LOCALE)
        shoot(desktop, "bureau", "dashboard", "clair", "tableau-de-bord", check=False)
        shoot(desktop, "bureau", "chauffeurs", "clair", "chauffeurs", check=False)
        desktop.close()

        # Page /installer/ (mobile iOS 26).
        inst = browser.new_context(
            viewport=IPHONE, device_scale_factor=3, is_mobile=True,
            has_touch=True, user_agent=IOS26_UA, **LOCALE,
        )
        ip = inst.new_page()
        try:
            ip.goto(BASE.replace("index.html", "") + "installer/", wait_until="networkidle")
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
        print("WebKit (Safari iOS) : alignement Date / Heures")
        shoot_date_heures(wk_iphone, "webkit-iphone")
        wk_iphone.close()
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
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
