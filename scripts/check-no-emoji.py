#!/usr/bin/env python3
"""Échoue si un émoji / caractère-icône pictographique traîne dans le front.
Autorisé : texte, flèches (← →), logos. Interdit : pictogrammes emoji (on veut
des icônes Lucide SVG partout). Lancé en CI."""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "front"
# Plages pictographiques emoji (hors flèches 2190-21FF, volontairement en texte).
EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF☀-➿⬀-⯿️⃣⌀-⏿]"
)
TARGETS = list(ROOT.rglob("*.html")) + list(ROOT.rglob("*.js")) + list(ROOT.rglob("*.webmanifest"))
bad = []
for f in TARGETS:
    if "/vendor/" in str(f):
        continue
    for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        for m in EMOJI.finditer(line):
            bad.append(f"{f.relative_to(ROOT.parent)}:{i}: U+{ord(m.group()):04X} {m.group()!r}")
if bad:
    print("Émoji / caractère-icône interdit (utiliser une icône Lucide SVG) :")
    print("\n".join(bad))
    sys.exit(1)
print("OK : aucun émoji pictographique dans le front.")
