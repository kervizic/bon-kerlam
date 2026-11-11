#!/usr/bin/env python3
"""Échoue si un LIBELLÉ VISIBLE du front contient le mot « LV » isolé.

« lettre(s) de voiture » doit être écrit en toutes lettres partout (titres,
cartes, boutons, menus, messages, aides). Exceptions :
  - les numéros KER-xxxxx (ils ne contiennent pas « LV ») ;
  - le short_name du manifest (« LV KERLAM »), volontairement conservé.
Ne sont PAS des libellés visibles, donc ignorés : les commentaires (HTML/JS),
le code (identifiants, classes CSS, routes), la doc (README). Lancé en CI.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "front"
WORD = re.compile(r"\bLV\b")


def html_visible(src: str) -> str:
    src = re.sub(r"<!--.*?-->", " ", src, flags=re.S)          # commentaires HTML
    src = re.sub(r"<style\b.*?</style>", " ", src, flags=re.S | re.I)
    src = re.sub(r"<script\b.*?</script>", " ", src, flags=re.S | re.I)
    # Attributs visibles par l'utilisateur ou l'assistance vocale.
    attrs = re.findall(r'(?:placeholder|aria-label|title|alt)\s*=\s*"([^"]*)"', src)
    text = re.sub(r"<[^>]+>", " ", src)                         # texte hors balises
    return text + "   " + "   ".join(attrs)


def js_visible(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)            # commentaires /* */
    # Commentaires de ligne // (sans casser les URL http://, https://).
    src = re.sub(r"(?<!:)//.*$", " ", src, flags=re.M)
    # Littéraux de chaîne restants = texte potentiellement affiché.
    parts = []
    parts += re.findall(r"'((?:[^'\\]|\\.)*)'", src)
    parts += re.findall(r'"((?:[^"\\]|\\.)*)"', src)
    parts += re.findall(r"`((?:[^`\\]|\\.)*)`", src)
    return "   ".join(parts)


bad: list[str] = []
for f in list(ROOT.rglob("*.html")) + list(ROOT.rglob("*.js")):
    if "/vendor/" in str(f):
        continue
    raw = f.read_text(encoding="utf-8")
    hay = html_visible(raw) if f.suffix == ".html" else js_visible(raw)
    for m in WORD.finditer(hay):
        if hay[m.start():m.start() + 9] == "LV KERLAM":          # short_name toléré
            continue
        ctx = hay[max(0, m.start() - 25):m.end() + 25].replace(" ", "·").strip()
        bad.append(f"{f.relative_to(ROOT.parent)}: … {ctx} …")

if bad:
    print("Libellé visible utilisant l'abréviation « LV » (écrire « lettre(s) de voiture ») :")
    print("\n".join(bad))
    sys.exit(1)
print("OK : aucun libellé visible n'utilise l'abréviation « LV ».")
