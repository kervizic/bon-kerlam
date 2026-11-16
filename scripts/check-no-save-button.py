#!/usr/bin/env python3
"""Échoue si un bouton / libellé « Enregistrer » apparaît dans le front.

beta.20 (décision Manu du 15/11) : enregistrement en temps réel PARTOUT, donc
AUCUN bouton « Enregistrer » nulle part (fiches rapides, écrans bureau…). On
cherche le libellé impératif « Enregistrer » (mot isolé, majuscule) dans le texte
visible et les littéraux de chaîne JS. Les commentaires (HTML/JS) et la doc sont
ignorés (ils peuvent décrire l'historique). N'attrape pas « enregistrement »,
« enregistré », « s'enregistre » (verbe conjugué / nom commun). Lancé en CI.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "front"
WORD = re.compile(r"\bEnregistrer\b")


def html_visible(src: str) -> str:
    src = re.sub(r"<!--.*?-->", " ", src, flags=re.S)
    src = re.sub(r"<style\b.*?</style>", " ", src, flags=re.S | re.I)
    src = re.sub(r"<script\b.*?</script>", " ", src, flags=re.S | re.I)
    attrs = re.findall(r'(?:placeholder|aria-label|title|alt|value)\s*=\s*"([^"]*)"', src)
    text = re.sub(r"<[^>]+>", " ", src)
    return text + "   " + "   ".join(attrs)


def js_visible(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"(?<!:)//.*$", " ", src, flags=re.M)
    parts: list[str] = []
    parts += re.findall(r"'((?:[^'\\]|\\.)*)'", src)
    parts += re.findall(r'"((?:[^"\\]|\\.)*)"', src)
    parts += re.findall(r"`((?:[^`\\]|\\.)*)`", src)
    return "   ".join(parts)


bad: list[str] = []
for f in list(ROOT.rglob("*.html")) + list(ROOT.rglob("*.js")):
    if "/vendor/" in str(f) or f.name.endswith(".test.mjs"):
        continue
    raw = f.read_text(encoding="utf-8")
    hay = html_visible(raw) if f.suffix == ".html" else js_visible(raw)
    if WORD.search(hay):
        ctx = hay[max(0, WORD.search(hay).start() - 25):WORD.search(hay).start() + 25].strip()
        bad.append(f"{f.relative_to(ROOT.parent)}: … {ctx} …")

if bad:
    print("Bouton/libellé « Enregistrer » interdit (enregistrement en temps réel partout) :")
    print("\n".join(bad))
    sys.exit(1)
print("OK : aucun bouton « Enregistrer » visible dans le front.")
