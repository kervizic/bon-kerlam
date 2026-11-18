#!/usr/bin/env python3
"""Compare le rendu PDF ANCIEN (polices variables) vs NOUVEAU (polices statiques
sous-ensemblées) sur des lettres réelles, et mesure le temps. beta.31.

- OLD : gabarit + polices installés dans l'image worker (/app/app/templates).
- NEW : gabarit + polices du dossier passé en argument (--newtpl).

Rendu identique attendu : on rasterise les deux PDF (pdftoppm -> PPM) et on
compare pixel à pixel (delta max + nombre de pixels différents).

Usage (dans le conteneur) :
  python compare_render.py --newtpl /work/newtpl --ids 7 8 9 --out /work/out
"""
from __future__ import annotations

import argparse
import os
import subprocess
import time

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

from app import pdf


def render_old(lv_id: int) -> tuple[bytes, float]:
    ctx = pdf.build_context(lv_id)
    t0 = time.perf_counter()
    b = pdf.render_pdf(ctx)
    return b, time.perf_counter() - t0


def render_new(lv_id: int, newtpl: str) -> tuple[bytes, float]:
    ctx = pdf.build_context(lv_id)
    env = Environment(loader=FileSystemLoader(newtpl), autoescape=select_autoescape(["html"]))
    html = env.get_template("lv.html").render(**ctx)
    t0 = time.perf_counter()
    b = HTML(string=html, base_url=newtpl + os.sep).write_pdf()
    return b, time.perf_counter() - t0


def to_ppm(pdf_path: str, prefix: str) -> list[str]:
    subprocess.run(["pdftoppm", "-r", "150", pdf_path, prefix], check=True)
    d = os.path.dirname(prefix) or "."
    base = os.path.basename(prefix)
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.startswith(base) and f.endswith(".ppm"))


def diff_ppm(a: str, b: str) -> tuple[int, int, int]:
    """(delta_max, pixels_diff, total) en lisant deux PPM binaires (P6)."""
    def read(p):
        with open(p, "rb") as f:
            data = f.read()
        assert data[:2] == b"P6", "PPM non P6"
        # en-tête : P6\n<w> <h>\n<maxval>\n
        idx = 2
        fields = []
        while len(fields) < 3:
            while idx < len(data) and data[idx] in b" \t\n\r":
                idx += 1
            start = idx
            while idx < len(data) and data[idx] not in b" \t\n\r":
                idx += 1
            fields.append(int(data[start:idx]))
        idx += 1  # un seul blanc après maxval
        return fields[0], fields[1], data[idx:]
    wa, ha, pa = read(a)
    wb, hb, pb = read(b)
    if (wa, ha) != (wb, hb):
        return 255, wa * ha, wa * ha
    n = min(len(pa), len(pb))
    dmax = 0
    diff = 0
    for i in range(n):
        d = abs(pa[i] - pb[i])
        if d:
            diff += 1
            if d > dmax:
                dmax = d
    return dmax, diff, n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--newtpl", required=True)
    ap.add_argument("--ids", nargs="+", type=int, required=True)
    ap.add_argument("--out", default="/work/out")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    # Préchauffe l'import/police (hors mesure).
    render_old(args.ids[0]); render_new(args.ids[0], args.newtpl)
    print(f"{'lv':>4} | {'old ms':>7} | {'new ms':>7} | {'gain':>5} | delta_max | pixels_diff")
    for lv_id in args.ids:
        ob, ot = render_old(lv_id)
        nb, nt = render_new(lv_id, args.newtpl)
        op = os.path.join(args.out, f"old_{lv_id}.pdf"); open(op, "wb").write(ob)
        npath = os.path.join(args.out, f"new_{lv_id}.pdf"); open(npath, "wb").write(nb)
        oppm = to_ppm(op, os.path.join(args.out, f"old_{lv_id}_"))
        nppm = to_ppm(npath, os.path.join(args.out, f"new_{lv_id}_"))
        dmax = 0; diff = 0; tot = 0
        for pa, pb in zip(oppm, nppm):
            dm, df, tt = diff_ppm(pa, pb)
            dmax = max(dmax, dm); diff += df; tot += tt
        gain = f"{ot/nt:.1f}x" if nt else "-"
        print(f"{lv_id:>4} | {ot*1000:>7.0f} | {nt*1000:>7.0f} | {gain:>5} | {dmax:>9} | {diff}/{tot}")


if __name__ == "__main__":
    main()
