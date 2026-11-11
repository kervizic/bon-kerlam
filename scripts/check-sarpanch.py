#!/usr/bin/env python3
"""Échoue si la police Sarpanch est utilisée ailleurs que pour le LOGO KERLAM.

Sarpanch (900) est réservée au logo (front + PDF). Partout ailleurs : police
système. On autorise sa déclaration (@font-face) et son emploi dans une règle
dont le sélecteur cible le logo (`.logo`). Lancé en CI.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = [
    ROOT / "front" / "assets" / "styles.css",
    ROOT / "worker" / "app" / "templates" / "lv.html",
]

bad: list[str] = []
# Découpe grossière en règles « sélecteur { corps } » ; @font-face autorisé.
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)
for f in TARGETS:
    if not f.exists():
        continue
    css = f.read_text(encoding="utf-8")
    if f.suffix in (".html", ".htm"):
        styles = re.findall(r"<style[^>]*>(.*?)</style>", css, re.S | re.I)
        css = "\n".join(styles)
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)  # retire les commentaires CSS
    for m in RULE.finditer(css):
        selector, body = m.group(1), m.group(2)
        if "Sarpanch" not in body:
            continue
        sel = selector.strip().lower()
        if sel.startswith("@font-face"):
            continue
        if ".logo" in sel:
            continue
        bad.append(f"{f.relative_to(ROOT)}: sélecteur « {selector.strip()[:60]} » utilise Sarpanch")

if bad:
    print("Sarpanch utilisée hors logo (réserver au logo KERLAM) :")
    print("\n".join(bad))
    sys.exit(1)
print("OK : Sarpanch réservée au logo.")
