#!/usr/bin/env python3
"""Captures d'écran responsive via Playwright (exécuté en CI).

Le front est servi en statique et ouvert en MODE DÉMO (?demo=1) : pas
d'authentification, données fictives (aucune donnée réelle). Les vues sont
adressables par ?screen=… et le thème forcé par ?theme=clair|sombre.

Sortie : dossier screenshots/ (publié comme artefact du run CI).
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080/index.html"
OUT = Path("screenshots")
OUT.mkdir(exist_ok=True)

MOBILE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}

MOBILE_SCREENS = [("aujourdhui", "aujourdhui"), ("tour", "tour"), ("site-picker", "choix-site")]
DESKTOP_SCREENS = [("tableau-de-bord", "tableau-de-bord"), ("chauffeurs", "chauffeurs")]


def shoot(page, screen: str, theme: str, label: str, viewport: dict) -> None:
    url = f"{BASE}?demo=1&screen={screen}&theme={theme}"
    page.set_viewport_size(viewport)
    page.emulate_media(color_scheme="dark" if theme == "sombre" else "light")
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(600)
    out = OUT / f"{'mobile' if viewport is MOBILE else 'bureau'}-{label}-{theme}.png"
    page.screenshot(path=str(out), full_page=False)
    print("  ", out)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for screen, label in MOBILE_SCREENS:
            for theme in ("clair", "sombre"):
                try:
                    shoot(page, screen, theme, label, MOBILE)
                except Exception as exc:  # noqa: BLE001
                    print(f"   !! {label}/{theme}: {exc}")
        for screen, label in DESKTOP_SCREENS:
            try:
                shoot(page, screen, "clair", label, DESKTOP)
            except Exception as exc:  # noqa: BLE001
                print(f"   !! {label}: {exc}")
        browser.close()
    n = len(list(OUT.glob("*.png")))
    print(f"{n} captures dans {OUT}/")
    return 0  # on ne casse jamais le job : l'artefact publie ce qui a été capturé


if __name__ == "__main__":
    raise SystemExit(main())
