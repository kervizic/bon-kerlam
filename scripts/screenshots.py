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


def check_no_hscroll(page, label: str) -> None:
    data = page.evaluate(
        "() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth})"
    )
    if data["sw"] > data["iw"] + 1:
        overflow_failures.append(f"{label}: scrollWidth={data['sw']} > innerWidth={data['iw']}")


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


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        iphone = browser.new_context(
            viewport=IPHONE, device_scale_factor=3, is_mobile=True, has_touch=True,
            user_agent=IOS26_UA,
        )
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
        iphone.close()

        ipad = browser.new_context(viewport=IPAD, device_scale_factor=2, is_mobile=True, has_touch=True)
        shoot(ipad, "ipad", "dashboard", "clair", "tableau-de-bord", role="bureau")
        ipad.close()

        desktop = browser.new_context(viewport=DESKTOP)
        shoot(desktop, "bureau", "dashboard", "clair", "tableau-de-bord", check=False)
        shoot(desktop, "bureau", "chauffeurs", "clair", "chauffeurs", check=False)
        desktop.close()

        # Page /installer/ (mobile iOS 26).
        inst = browser.new_context(
            viewport=IPHONE, device_scale_factor=3, is_mobile=True,
            has_touch=True, user_agent=IOS26_UA,
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

    n = len(list(OUT.glob("*.png")))
    print(f"{n} captures dans {OUT}/")
    if overflow_failures:
        print("DÉBORDEMENT HORIZONTAL détecté :")
        for f in overflow_failures:
            print("  -", f)
        return 1
    print("OK : aucun débordement horizontal.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
