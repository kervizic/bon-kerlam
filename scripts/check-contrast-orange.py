#!/usr/bin/env python3
"""Échoue si du TEXTE BLANC est posé sur le FOND ORANGE de marque.

Règle de marque KERLAM : l'orange (--c-orange / #FD8008) est une SURFACE ; le
texte dessus est TOUJOURS anthracite, JAMAIS blanc (contraste + identité). Ce
contrôle parcourt les règles de styles.css ; pour chaque règle dont le
`background`/`background-color` est l'orange de marque, il vérifie qu'aucune
`color` blanche n'est déclarée. Garde-fou de non-régression (beta.21, onglets
Chauffeur/Bureau actifs). Lancé en CI.
"""
from __future__ import annotations

import pathlib
import re
import sys

CSS = pathlib.Path(__file__).resolve().parent.parent / "front" / "assets" / "styles.css"

ORANGE = re.compile(r"(var\(--c-orange\)|#fd8008)", re.I)
WHITE = re.compile(r"(#fff\b|#ffffff\b|\bwhite\b|var\(--c-white\))", re.I)
# Une règle CSS : « sélecteurs { déclarations } » (pas de règles imbriquées ici).
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)

src = CSS.read_text(encoding="utf-8")
# On retire les commentaires pour ne pas confondre un exemple décrit en prose.
src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)

bad: list[str] = []
for selectors, body in RULE.findall(src):
    decls = {}
    for decl in body.split(";"):
        if ":" not in decl:
            continue
        prop, _, val = decl.partition(":")
        decls[prop.strip().lower()] = val.strip()
    bg = decls.get("background", "") + " " + decls.get("background-color", "")
    color = decls.get("color", "")
    if ORANGE.search(bg) and WHITE.search(color):
        sel = " ".join(selectors.split())
        bad.append(f"{sel} {{ color: {color}; background: {bg.strip()} }}")

if bad:
    print("TEXTE BLANC sur FOND ORANGE détecté (utiliser anthracite) :")
    for b in bad:
        print("  -", b)
    sys.exit(1)
print("OK : aucun texte blanc sur l'orange de marque (anthracite partout).")
