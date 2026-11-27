#!/usr/bin/env python3
"""E2E beta.35 — photos « Avant » / « Après » par ligne de marchandise (mode démo).

WebKit (iPhone, UA Safari iOS) ET Chromium (mobile) : prise de photo simulée
(sélecteur de fichier avec une image de test 3000x2000 contenant un bloc EXIF
« GPS-SECRET »), filigrane visible (bandeau sombre en bas, 1600 px, EXIF supprimé),
vignette, visionneuse (balayage + flèches), suppression, hors ligne -> vignette
« en attente » -> envoi automatique au retour du réseau, compteur du tour replié.
Captures clair + sombre dans screenshots/.

Usage : python scripts/e2e_photos.py http://127.0.0.1:8080/index.html [webkit|chromium|all]
"""
from __future__ import annotations

import struct
import sys
import tempfile
import zlib
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080/index.html"
WHICH = sys.argv[2] if len(sys.argv) > 2 else "all"
OUT = Path("screenshots")
OUT.mkdir(exist_ok=True)
IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1")
IPHONE = {"width": 393, "height": 852}
LOCALE = {"locale": "fr-FR", "timezone_id": "Europe/Paris"}
GEO = {"latitude": 48.8566, "longitude": 2.3522, "accuracy": 15}

failures: list[str] = []


def check(cond, msg):
    print(("  ok: " if cond else "  FAIL: ") + msg)
    if not cond:
        failures.append(msg)


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def make_png(path: Path, w: int = 3000, h: int = 2000) -> None:
    """PNG blanc (fond CLAIR : pire cas de lisibilité) + chunk eXIf factice."""
    row = b"\x00" + b"\xff\xff\xff" * w
    raw = zlib.compress(row * h, 9)
    exif = b"MM\x00*\x00\x00\x00\x08GPS-SECRET-48.1234-2.5678"
    png = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + _chunk(b"eXIf", exif) + _chunk(b"IDAT", raw) + _chunk(b"IEND", b""))
    path.write_bytes(png)


# Analyse de l'image pleine résolution affichée dans la visionneuse.
ANALYSE = """async () => {
  const img = document.querySelector('#photo-viewer .pv-img');
  const res = await fetch(img.src);
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = Array.from(buf.slice(0, 4));
  const txt = new TextDecoder('latin1').decode(buf);
  const bmp = await createImageBitmap(new Blob([buf], {type: 'image/jpeg'}));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
  const lum = (y0, y1) => { const d = ctx.getImageData(0, y0, c.width, y1 - y0).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i+1] + d[i+2]) / 3; return s / (d.length / 4); };
  return { w: bmp.width, h: bmp.height, jpeg: head[0] === 0xff && head[1] === 0xd8,
           exif: txt.includes('Exif') || txt.includes('GPS-SECRET') || txt.includes('http://ns.adobe.com/xap'),
           top: lum(0, 40), bottom: lum(c.height - 30, c.height) };
}"""

SWIPE = """(dir) => {
  const el = document.getElementById('photo-viewer');
  const mk = (type, x) => { const e = new Event(type, {bubbles: true});
    const t = [{clientX: x, clientY: 300}];
    Object.defineProperty(e, type === 'touchend' ? 'changedTouches' : 'touches', {value: t});
    return e; };
  const [a, b] = dir === 'left' ? [300, 80] : [80, 300];
  el.dispatchEvent(mk('touchstart', a)); el.dispatchEvent(mk('touchend', b));
}"""


def take_photo(page, row, type_, img, gallery=False):
    row.locator(".btn-photo-ligne").click()
    sheet = page.locator("#photo-type-sheet")
    expect(sheet).to_be_visible(timeout=4000)
    sel = f'[data-photo-type="{type_}"]' + ("[data-gallery]" if gallery else ":not([data-gallery])")
    with page.expect_file_chooser() as fc:
        sheet.locator(sel).click()
    fc.value.set_files(str(img))
    expect(sheet).to_be_hidden(timeout=4000)


def run(ctx, name, img):
    print(f"[{name}]")
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    try:
        page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme=clair", wait_until="load")
        row = page.locator("#tours-list .ligne-row").first
        expect(row.locator(".btn-photo-ligne")).to_be_visible(timeout=10000)
        strip = row.locator(".ligne-photos")
        check(strip.is_hidden(), f"{name}: aucune vignette avant la 1re photo")

        # 1. Photo « Avant » (appareil photo simulé).
        take_photo(page, row, "avant", img)
        thumbs = row.locator(".lp-thumb")
        expect(thumbs).to_have_count(1, timeout=10000)
        expect(row.locator(".lp-thumb.is-pending")).to_have_count(0, timeout=10000)
        check(row.locator('.lp-group[data-type="avant"] .lp-label').inner_text() == "Avant", f"{name}: groupe Avant")
        check(row.locator(".lp-count").inner_text() == "1", f"{name}: compteur sur l'icône = 1")

        # 2. Photo « Après » depuis la galerie.
        take_photo(page, row, "apres", img, gallery=True)
        expect(thumbs).to_have_count(2, timeout=10000)
        check(row.locator('.lp-group[data-type="apres"] .lp-thumb').count() == 1, f"{name}: groupe Après")
        page.screenshot(path=str(OUT / f"beta35-{name}-ligne-vignettes-clair.png"))

        # 3. Visionneuse + filigrane.
        thumbs.first.click()
        viewer = page.locator("#photo-viewer")
        expect(viewer).to_be_visible(timeout=4000)
        expect(viewer.locator(".pv-caption")).to_contain_text("Avant · 1/2")
        page.wait_for_function("() => { const i = document.querySelector('#photo-viewer .pv-img');"
                               " return i && i.complete && i.naturalWidth > 0; }", timeout=8000)
        a = page.evaluate(ANALYSE)
        print("   image:", a)
        check(a["jpeg"], f"{name}: image envoyée en JPEG")
        check(max(a["w"], a["h"]) == 1600, f"{name}: redimensionnée à 1600 px côté long ({a['w']}x{a['h']})")
        check(not a["exif"], f"{name}: EXIF d'origine supprimé (pas de GPS-SECRET)")
        band = f"haut {a['top']:.0f} / bas {a['bottom']:.0f}"
        check(a["top"] > 240 and a["bottom"] < 200, f"{name}: bandeau de filigrane sombre en bas ({band})")
        page.screenshot(path=str(OUT / f"beta35-{name}-visionneuse.png"))
        # Balayage vers la gauche -> photo suivante ; flèche -> retour.
        page.evaluate(SWIPE, "left")
        expect(viewer.locator(".pv-caption")).to_contain_text("Après · 2/2", timeout=3000)
        viewer.locator(".pv-prev").click()
        expect(viewer.locator(".pv-caption")).to_contain_text("Avant · 1/2", timeout=3000)
        # 4. Suppression (confirmation acceptée) par l'auteur.
        check(viewer.locator(".pv-delete").is_visible(), f"{name}: bouton supprimer visible pour l'auteur")
        viewer.locator(".pv-delete").click()
        expect(viewer.locator(".pv-caption")).to_contain_text("Après · 1/1", timeout=3000)
        viewer.locator(".pv-close").click()
        expect(viewer).to_be_hidden()
        expect(thumbs).to_have_count(1)

        # 5. Hors ligne : vignette immédiate « en attente », envoi au retour du réseau.
        # Chromium : vraie coupure (context.set_offline). WebKit : l'émulation hors
        # ligne de Playwright bloque AUSSI le décodage local (blob:/data:), ce qu'un
        # iPhone réel ne fait pas -> on coupe le réseau par interception (toutes les
        # requêtes HTTP échouent, comme sans réseau) + évènement « offline ».
        real_offline = "webkit" not in name
        if real_offline:
            ctx.set_offline(True)
        else:
            page.route("**/*", lambda route: route.abort("internetdisconnected"))
            page.evaluate("() => window.dispatchEvent(new Event('offline'))")
        take_photo(page, row, "avant", img)
        expect(row.locator(".lp-thumb.is-pending")).to_have_count(1, timeout=10000)
        page.wait_for_timeout(800)
        check(row.locator(".lp-thumb.is-pending").count() == 1, f"{name}: photo restée en attente hors ligne")
        check(page.locator(".banner, .offline-banner").filter(has_text="photo").count() == 0,
              f"{name}: aucune bannière photo")
        page.screenshot(path=str(OUT / f"beta35-{name}-hors-ligne-en-attente.png"))
        if real_offline:
            ctx.set_offline(False)
        else:
            page.unroute("**/*")
        page.evaluate("() => window.dispatchEvent(new Event('online'))")
        expect(row.locator(".lp-thumb.is-pending")).to_have_count(0, timeout=15000)
        expect(thumbs).to_have_count(2)
        check(True, f"{name}: envoyée automatiquement au retour du réseau")

        # 6. Tour replié : compteur discret dans le résumé.
        card = page.locator("#tours-list .tour-card").filter(has=page.locator(".ligne-row")).first
        card.locator(".tour-collapse").click()
        expect(card.locator(".tour-summary")).to_contain_text("2 photos", timeout=3000)
        card.locator(".tour-collapse").click()

        # 7. Sombre : vignettes + feuille de choix.
        page.goto(f"{BASE}?demo=1&screen=today&role=chauffeur&theme=sombre", wait_until="load")
        row = page.locator("#tours-list .ligne-row").first
        expect(row.locator(".btn-photo-ligne")).to_be_visible(timeout=10000)
        take_photo(page, row, "avant", img)
        expect(row.locator(".lp-thumb")).to_have_count(1, timeout=10000)
        page.screenshot(path=str(OUT / f"beta35-{name}-ligne-vignettes-sombre.png"))
        row.locator(".btn-photo-ligne").click()
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"beta35-{name}-choix-avant-apres-sombre.png"))
        page.locator("#photo-type-sheet .pt-close").click()
        row.locator(".lp-thumb").first.click()
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / f"beta35-{name}-visionneuse-sombre.png"))
        check(not errors, f"{name}: aucune erreur JS ({errors[:2]})")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"{name}: exception {exc}")
        print("  !!", exc)
        page.screenshot(path=str(OUT / f"beta35-{name}-ECHEC.png"))
    finally:
        page.close()


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    img = tmp / "test-3000x2000.png"
    make_png(img)
    with sync_playwright() as p:
        common = {"viewport": IPHONE, "is_mobile": True, "has_touch": True, "geolocation": GEO,
                  "permissions": ["geolocation"], "service_workers": "block", **LOCALE}
        if WHICH in ("all", "webkit"):
            b = p.webkit.launch()
            ctx = b.new_context(user_agent=IOS_UA, device_scale_factor=3, **common)
            ctx.set_default_timeout(8000)
            run(ctx, "webkit-iphone", img)
            b.close()
        if WHICH in ("all", "chromium"):
            b = p.chromium.launch(args=["--lang=fr-FR"])
            ctx = b.new_context(device_scale_factor=2, **common)
            ctx.set_default_timeout(8000)
            run(ctx, "chromium", img)
            b.close()
    if failures:
        print("beta.35 photos KO :")
        for f in failures:
            print("  -", f)
        return 1
    print("OK : beta.35 photos par ligne (WebKit + Chromium).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
