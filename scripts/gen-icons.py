#!/usr/bin/env python3
"""Génère les icônes PWA « KL » (Sarpanch ExtraBold) au build.

K en gris clair, L en orange KERLAM, sur fond anthracite. Produit :
icon-192/512, maskable-192/512 (zone de sécurité), apple-touch-180, favicon.

Usage : python scripts/gen-icons.py [font.ttf] [out_dir]
Déps : Pillow (installé dans l'étape de build, jamais sur le Mac hors .venv).
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = (43, 43, 43)          # #2B2B2B anthracite
GREY = (201, 201, 201)     # #C9C9C9 gris clair (K)
ORANGE = (253, 128, 8)     # #FD8008 (L)
TEXT = "KL"


def render(font_path: str, size: int, out: Path, safe: float = 1.0) -> None:
    img = Image.new("RGBA", (size, size), BG + (255,))
    draw = ImageDraw.Draw(img)
    # Taille de police pour que "KL" occupe ~ safe * size.
    target = size * 0.62 * safe
    fs = int(target)
    font = ImageFont.truetype(font_path, fs)
    # Mesure et recentre.
    bbox = draw.textbbox((0, 0), TEXT, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    while (tw > size * 0.82 * safe or th > size * 0.82 * safe) and fs > 8:
        fs -= 2
        font = ImageFont.truetype(font_path, fs)
        bbox = draw.textbbox((0, 0), TEXT, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    # Largeur du K pour colorer séparément K (gris) et L (orange).
    kbox = draw.textbbox((0, 0), "K", font=font)
    kw = kbox[2] - kbox[0]
    draw.text((x, y), "K", font=font, fill=GREY)
    draw.text((x + kw, y), "L", font=font, fill=ORANGE)
    img.save(out)
    print(f"  {out.name} ({size}px)")


def main() -> int:
    font_path = sys.argv[1] if len(sys.argv) > 1 else "build-assets/Sarpanch.ttf"
    out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "front/assets/icons")
    out_dir.mkdir(parents=True, exist_ok=True)
    render(font_path, 192, out_dir / "icon-192.png")
    render(font_path, 512, out_dir / "icon-512.png")
    # Maskable : glyphe plus petit (zone de sécurité ~80 %).
    render(font_path, 192, out_dir / "maskable-192.png", safe=0.78)
    render(font_path, 512, out_dir / "maskable-512.png", safe=0.78)
    render(font_path, 180, out_dir / "apple-touch-180.png")
    render(font_path, 32, out_dir / "favicon-32.png")
    # favicon.ico multi-tailles.
    ico = Image.open(out_dir / "favicon-32.png")
    ico.save(out_dir / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("  favicon.ico")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
