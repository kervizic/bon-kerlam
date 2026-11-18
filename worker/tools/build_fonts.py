#!/usr/bin/env python3
"""Sous-ensemble les polices Inter du PDF (beta.31), en gardant leur caractère
VARIABLE.

La police Inter livrée est variable (~880 Ko, ~2900 glyphes). WeasyPrint l'instancie
à la graisse demandée à CHAQUE rendu ; ce coût est proportionnel au nombre de glyphes
(6-11 s/lettre). On garde donc la police variable (WeasyPrint rend EXACTEMENT comme
avant -> pixels identiques) mais on la réduit aux ~300 caractères latins/français +
symboles réellement imprimables : l'instanciation devient ~10x plus rapide.

On NE pré-instancie PAS en statique : cela change très légèrement les contours des
gros textes (titre) vs l'instanciation interne de WeasyPrint. Garder la police
variable + ne faire que du sous-ensemblage garantit un rendu identique au pixel.

Idempotent. Usage : python worker/tools/build_fonts.py
"""
from __future__ import annotations

import os

from fontTools import subset

# Sources variables COMPLÈTES (non embarquées dans l'image) -> sorties sous-ensemblées
# dans le dossier des polices du gabarit (embarqué).
SRC_DIR = os.path.join(os.path.dirname(__file__), "fonts-src")
FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "templates", "fonts")

# latin de base + latin-1 (accents FR, °·×«»²³) + latin étendu-A (noms européens)
# + ponctuation/symboles du gabarit et du contenu (– — ' ' " " … ‹ › € → − • m³).
UNICODES = (
    list(range(0x0020, 0x017F + 1))
    + [
        0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E,
        0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203A,
        0x20AC, 0x2122, 0x2192, 0x2212, 0x2219, 0x02C6, 0x02DC,
    ]
)


def _subset(src: str, out: str) -> int:
    opt = subset.Options()
    opt.layout_features = ["*"]  # conserve le crénage (kern/GPOS)
    opt.name_IDs = ["*"]
    opt.notdef_glyph = True
    opt.recalc_bounds = True
    opt.flavor = "woff2"  # compression brotli
    # On NE met PAS opt.instancer : on garde fvar/gvar (police variable).
    subsetter = subset.Subsetter(options=opt)
    subsetter.populate(unicodes=UNICODES)
    from fontTools.ttLib import TTFont

    font = TTFont(src)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(out)
    return os.path.getsize(out)


def main() -> None:
    jobs = [
        ("Inter.ttf", "Inter-subset.woff2"),
        ("Inter-Italic.ttf", "Inter-Italic-subset.woff2"),
    ]
    total = before = 0
    for src_name, out_name in jobs:
        src = os.path.join(SRC_DIR, src_name)
        out = os.path.join(FONTS_DIR, out_name)
        size = _subset(src, out)
        total += size
        before += os.path.getsize(src)
        print(f"{out_name} : {size/1024:.1f} Ko (variable, sous-ensemblée)")
    print(f"Total : {total/1024:.1f} Ko (avant : {before/1024:.1f} Ko)")


if __name__ == "__main__":
    main()
