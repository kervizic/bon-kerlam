#!/usr/bin/env python3
"""Échoue si le mot « expéditeur » (ou « expediteur ») apparaît dans un LIBELLÉ
VISIBLE du front. Décision Manu (D) : un seul champ « Client » ; l'expéditeur
n'existe plus dans l'appli, il est seulement imprimé sur le PDF (dérivé du client).
Commentaires et code ignorés. Lancé en CI.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "front"
# Mot FRANÇAIS visible (accentué). Le nom de colonne « expediteur » (sans accent)
# reste en base/code : seul le libellé « expéditeur » est proscrit de l'interface.
WORD = re.compile(r"expéditeur", re.IGNORECASE)


def html_visible(src: str) -> str:
    src = re.sub(r"<!--.*?-->", " ", src, flags=re.S)
    src = re.sub(r"<style\b.*?</style>", " ", src, flags=re.S | re.I)
    src = re.sub(r"<script\b.*?</script>", " ", src, flags=re.S | re.I)
    attrs = re.findall(r'(?:placeholder|aria-label|title|alt)\s*=\s*"([^"]*)"', src)
    text = re.sub(r"<[^>]+>", " ", src)
    return text + "   " + "   ".join(attrs)


def js_visible(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"(?<!:)//.*$", " ", src, flags=re.M)
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
        ctx = hay[max(0, m.start() - 25):m.end() + 25].replace(" ", "·").strip()
        bad.append(f"{f.relative_to(ROOT.parent)}: … {ctx} …")

if bad:
    print("Le mot « expéditeur » ne doit plus apparaître dans le front (D) :")
    print("\n".join(bad))
    sys.exit(1)
print("OK : aucun « expéditeur » visible dans le front.")
