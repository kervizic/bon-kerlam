#!/usr/bin/env python3
"""E2E beta.36 - « Mes documents » (mode démo).

WebKit (iPhone, UA Safari iOS) ET Chromium (mobile) :
  - ajout d'un permis recto (appareil photo simulé) + verso (galerie) en mode
    scanner : coins détectés automatiquement sur une photo de carte en
    perspective, N&B, export JPEG <= 2000 px sans EXIF ;
  - expiration < 60 j -> pastille orange ; date passée -> pastille rouge ;
  - « Montrer » : visionneuse plein écran, recto/verso, zoom pincé ;
  - hors ligne : documents toujours affichés et montrables, ajout (PDF) mis en
    file puis envoyé au retour du réseau ;
  - déconnexion : cache local et file purgés ;
  - écran admin (lecture) ; entrée admin invisible pour un chauffeur.
Captures clair + sombre dans screenshots/.

Usage : python scripts/e2e_documents.py http://127.0.0.1:8080/index.html [webkit|chromium|all]
"""
from __future__ import annotations

import datetime as dt
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
# Carte en perspective sur fond sombre (coins attendus, image 1800x1200).
W, H = 1800, 1200
QUAD = [(300, 180), (1560, 270), (1440, 1050), (240, 990)]

TO_REGLAGES = '.bottom-bar-item[data-route="reglages"]:visible, .side-nav a[data-route="reglages"]:visible'
failures: list[str] = []


def check(cond, msg):
    print(("  ok: " if cond else "  FAIL: ") + msg)
    if not cond:
        failures.append(msg)


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _inside(x, y):
    c = False
    j = 3
    for i in range(4):
        (xi, yi), (xj, yj) = QUAD[i], QUAD[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def make_card_png(path: Path) -> None:
    """Photo simulée : fond sombre, carte claire en perspective, chunk EXIF factice."""
    rows = []
    for y in range(H):
        xs = []
        for i in range(4):
            (x1, y1), (x2, y2) = QUAD[i], QUAD[(i + 1) % 4]
            if (y1 <= y < y2) or (y2 <= y < y1):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        a, b = (int(xs[0]), int(xs[-1])) if len(xs) >= 2 else (0, -1)
        bg = b"\x30\x34\x30"
        card = b"\xe6\xe4\xd8"
        line = bytearray(bg * W)
        if b >= a:
            line[a * 3:(b + 1) * 3] = card * (b - a + 1)
            # « texte » : bande sombre au milieu de la carte
            if 0.45 < (y - 180) / 870 < 0.55:
                m = a + (b - a) // 8
                n = b - (b - a) // 8
                line[m * 3:n * 3] = b"\x20\x20\x28" * (n - m)
        rows.append(b"\x00" + bytes(line))
    raw = zlib.compress(b"".join(rows), 6)
    exif = b"MM\x00*\x00\x00\x00\x08GPS-SECRET-48.1234-2.5678"
    png = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
           + _chunk(b"eXIf", exif) + _chunk(b"IDAT", raw) + _chunk(b"IEND", b""))
    path.write_bytes(png)


def make_pdf(path: Path) -> None:
    content = b"BT /F1 24 Tf 72 720 Td (Attestation ADR) Tj ET"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    path.write_bytes(bytes(out))


ANALYSE = """async () => {
  const img = document.querySelector('#doc-viewer .dv-img');
  const res = await fetch(img.src);
  const buf = new Uint8Array(await res.arrayBuffer());
  const txt = new TextDecoder('latin1').decode(buf);
  const bmp = await createImageBitmap(new Blob([buf], {type: 'image/jpeg'}));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
  const px = (x, y) => {
    const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const corner = px(6, 6); const mid = px(c.width / 2, c.height * 0.5);
  return { w: bmp.width, h: bmp.height, jpeg: buf[0] === 0xff && buf[1] === 0xd8,
           exif: txt.includes('Exif') || txt.includes('GPS-SECRET'),
           corner, mid, grey: corner[0] === corner[1] && corner[1] === corner[2] };
}"""

PINCH = """() => {
  const st = document.querySelector('#doc-viewer .dv-stage');
  const r = st.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const ev = (type, id, x) => st.dispatchEvent(new PointerEvent(type, {pointerId: id, clientX: x, clientY: cy,
    bubbles: true, pointerType: 'touch', isPrimary: id === 1}));
  ev('pointerdown', 1, cx - 40); ev('pointerdown', 2, cx + 40);
  ev('pointermove', 1, cx - 120); ev('pointermove', 2, cx + 120);
  ev('pointerup', 1, cx - 120); ev('pointerup', 2, cx + 120);
  return parseFloat(document.querySelector('#doc-viewer .dv-zoom').dataset.scale || '1');
}"""

IDB_COUNT = """async () => {
  const count = (db, store) => new Promise((res) => {
    const r = indexedDB.open(db, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(store, { keyPath: 'id' });
    r.onsuccess = () => { const t = r.result.transaction(store, 'readonly').objectStore(store).count();
      t.onsuccess = () => { res(t.result); r.result.close(); }; t.onerror = () => res(-1); };
    r.onerror = () => res(-1);
  });
  return { cache: await count('bon-docs-cache-demo', 'docs'), queue: await count('bon-docs-queue-demo', 'queue') };
}"""


# Cache local (base réelle « bon-docs-cache ») avec un permis : image PNG 2x1 en
# ArrayBuffer, format packBlobs() de photo-queue.js.
SEED_CACHE = """async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 120;
  const g = c.getContext('2d'); g.fillStyle = '#dde'; g.fillRect(0, 0, 200, 120);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
  const buf = await blob.arrayBuffer();
  const p = 'u/9/d0000009-0000-4000-8000-000000000001/f0000009-0000-4000-8000-000000000001.jpg';
  const rec = { id: 'd0000009-0000-4000-8000-000000000001', owner: 'x@kerlam.fr',
    row: { id: 'd0000009-0000-4000-8000-000000000001', type: 'permis', recto_path: p, expiration: null },
    files: { [p]: { __blob: buf, type: 'image/jpeg' } } };
  await new Promise((res, rej) => {
    const r = indexedDB.open('bon-docs-cache', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
    r.onsuccess = () => { const t = r.result.transaction('docs', 'readwrite'); t.objectStore('docs').put(rec);
      t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
    r.onerror = () => rej(r.error);
  });
}"""


def iso(days):
    return (dt.date.today() + dt.timedelta(days=days)).isoformat()


def capture(page, side, kind, file):
    slot = page.locator(f'#doc-sheet .doc-face[data-side="{side}"]')
    with page.expect_file_chooser() as fc:
        slot.locator(f'[data-pick="{kind}"]').click()
    fc.value.set_files(str(file))


def run(ctx, name, img, pdf):
    print(f"[{name}]")
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    try:
        # Entrée depuis Réglages ; pas d'entrée admin pour un chauffeur.
        page.goto(f"{BASE}?demo=1&screen=reglages&role=chauffeur&theme=clair", wait_until="load")
        link = page.locator('#view-reglages .reglages-docs-link[data-route="mes-documents"]')
        expect(link).to_be_visible(timeout=10000)
        check(page.locator('#view-reglages .reglages-docs-link.nav-admin').is_hidden(),
              f"{name}: entrée admin masquée pour un chauffeur")
        link.click()
        expect(page.locator("#view-mes-documents")).to_be_visible(timeout=5000)
        expect(page.locator("#docs-empty")).to_be_visible(timeout=5000)

        # 1. Nouveau permis : recto (appareil photo) en mode scanner.
        page.locator("#btn-doc-add").click()
        sheet = page.locator("#doc-sheet")
        expect(sheet).to_be_visible()
        check(sheet.locator('input[name="doc-type"][value="permis"]').is_checked(), f"{name}: permis par défaut")
        capture(page, "recto", "camera", img)
        scanner = page.locator("#doc-scanner")
        expect(scanner).to_be_visible(timeout=10000)
        page.wait_for_timeout(300)
        st = page.evaluate("() => window.bonDocs._scanner._state()")
        ok = all(abs(c["x"] - q[0]) < 30 and abs(c["y"] - q[1]) < 30 for c, q in zip(st["corners"], QUAD))
        found = [(round(c["x"]), round(c["y"])) for c in st["corners"]]
        check(ok, f"{name}: 4 coins détectés automatiquement ({found})")
        page.screenshot(path=str(OUT / f"beta36-{name}-scanner-clair.png"))
        scanner.locator('[data-ds-mode="nb"]').click()
        scanner.locator(".ds-ok").click()
        expect(scanner).to_be_hidden(timeout=15000)
        expect(sheet.locator('.doc-face[data-side="recto"] .doc-face-preview img')).to_be_visible(timeout=5000)

        # 2. Verso depuis la galerie (couleur).
        capture(page, "verso", "gallery", img)
        expect(scanner).to_be_visible(timeout=10000)
        scanner.locator('[data-ds-mode="couleur"]').click()
        scanner.locator(".ds-ok").click()
        expect(scanner).to_be_hidden(timeout=15000)
        expect(sheet.locator('.doc-face[data-side="verso"] .doc-face-preview img')).to_be_visible(timeout=5000)

        # 3. Expiration dans 30 j + n°.
        sheet.locator("#doc-numero").fill("12AB34567")
        sheet.locator("#doc-expiration").fill(iso(30))
        sheet.locator("#doc-expiration").dispatch_event("change")
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / f"beta36-{name}-fiche-clair.png"))
        sheet.locator(".doc-sheet-close").click()
        card = page.locator('#docs-list .doc-card[data-type="permis"]')
        expect(card).to_have_count(1, timeout=5000)
        expect(card.locator(".doc-dot.is-soon")).to_be_visible(timeout=5000)
        expect(page.locator("#docs-list .doc-card.is-pending")).to_have_count(0, timeout=10000)
        check("N° 12AB34567" in card.inner_text(), f"{name}: n° affiché")
        expect(card.locator(".doc-thumb img")).to_be_visible()
        page.screenshot(path=str(OUT / f"beta36-{name}-liste-clair.png"))

        # 4. « Montrer » : plein écran, image traitée, recto/verso, zoom pincé.
        card.locator(".doc-show").click()
        viewer = page.locator("#doc-viewer")
        expect(viewer).to_be_visible()
        expect(viewer.locator(".dv-img")).to_be_visible(timeout=5000)
        page.wait_for_timeout(300)
        a = page.evaluate(ANALYSE)
        check(a["jpeg"] and not a["exif"], f"{name}: JPEG sans EXIF")
        check(max(a["w"], a["h"]) <= 2000 and a["w"] > 1000 and a["w"] > a["h"],
              f"{name}: redressé, <= 2000 px, paysage ({a['w']}x{a['h']})")
        check(a["grey"] and a["corner"][0] > 200, f"{name}: recto N&B, bord de carte clair (pas de fond) {a['corner']}")
        check(a["mid"][0] < 90, f"{name}: bandeau sombre au centre {a['mid']}")
        check(viewer.locator(".dv-sides").is_visible(), f"{name}: bascule recto / verso")
        scale = page.evaluate(PINCH)
        check(scale > 1.5, f"{name}: zoom pincé (x{scale})")
        page.screenshot(path=str(OUT / f"beta36-{name}-montrer-zoom.png"))
        recto_src = viewer.locator(".dv-img").get_attribute("src")
        viewer.locator('[data-dv-side="verso"]').click()
        expect(viewer.locator('.dv-zoom[data-side="verso"] .dv-img')).to_be_visible(timeout=5000)
        page.wait_for_timeout(300)
        b = page.evaluate(ANALYSE)
        check(viewer.locator(".dv-img").get_attribute("src") != recto_src and b["jpeg"] and not b["exif"],
              f"{name}: verso affiché ({b['w']}x{b['h']})")
        check(page.evaluate("() => document.querySelector('#doc-viewer .dv-zoom').dataset.scale") == "1.00",
              f"{name}: zoom remis à 1 au changement de face")
        viewer.locator(".dv-close").click()
        expect(viewer).to_be_hidden()

        # 5. Date passée -> pastille rouge.
        card.locator(".doc-card-main").click()
        expect(sheet).to_be_visible()
        sheet.locator("#doc-expiration").fill(iso(-3))
        sheet.locator("#doc-expiration").dispatch_event("change")
        sheet.locator(".doc-sheet-close").click()
        expect(card.locator(".doc-dot.is-expired")).to_be_visible(timeout=5000)

        # 6. Hors ligne : affichage + Montrer depuis le cache ; ajout PDF en file.
        page.wait_for_timeout(500)
        # Chromium : vraie coupure (context.set_offline). WebKit : l'émulation hors
        # ligne de Playwright bloque aussi la lecture des Blob locaux (artefact de
        # l'outil, pas de Safari) : coupure par interception de TOUTES les requêtes
        # HTTP (comme sans réseau), comme pour l'e2e beta.35.
        real_offline = "webkit" not in name
        if real_offline:
            ctx.set_offline(True)
        else:
            page.route("**/*", lambda route: route.abort("internetdisconnected"))
        page.evaluate("() => window.dispatchEvent(new Event('offline'))")
        page.locator(TO_REGLAGES).first.click()
        page.locator('#view-reglages .reglages-docs-link[data-route="mes-documents"]').click()
        expect(card).to_have_count(1, timeout=5000)
        expect(card.locator(".doc-thumb img")).to_be_visible()
        card.locator(".doc-show").click()
        expect(viewer.locator(".dv-img")).to_be_visible(timeout=5000)
        try:
            page.wait_for_function(
                "() => { const i = document.querySelector('#doc-viewer .dv-img');"
                " return i && i.complete && i.naturalWidth > 0; }",
                timeout=5000)
            shown = True
        except Exception:  # noqa: BLE001
            shown = False
        check(shown, f"{name}: document montré hors ligne")
        viewer.locator(".dv-close").click()
        page.locator("#btn-doc-add").click()
        sheet.locator('input[name="doc-type"][value="autre"]').check()
        sheet.locator("#doc-libelle").fill("ADR")
        capture(page, "recto", "pdf", pdf)
        expect(sheet.locator('.doc-face[data-side="recto"] .doc-thumb.is-pdf')).to_be_visible(timeout=5000)
        sheet.locator(".doc-sheet-close").click()
        pend = page.locator('#docs-list .doc-card.is-pending[data-type="autre"]')
        expect(pend).to_have_count(1, timeout=5000)
        check("ADR" in pend.inner_text(), f"{name}: libellé libre « ADR »")
        page.screenshot(path=str(OUT / f"beta36-{name}-hors-ligne-en-attente.png"))
        if real_offline:
            ctx.set_offline(False)
        else:
            page.unroute("**/*")
        page.evaluate("() => window.dispatchEvent(new Event('online'))")
        expect(page.locator("#docs-list .doc-card.is-pending")).to_have_count(0, timeout=15000)
        check(page.locator("#docs-list .doc-card").count() == 2, f"{name}: 2 documents après envoi")

        # 7. Sombre : liste + fiche + visionneuse (même session : données démo en mémoire).
        page.evaluate("() => document.documentElement.setAttribute('data-theme', 'sombre')")
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / f"beta36-{name}-liste-sombre.png"))
        card.locator(".doc-card-main").click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / f"beta36-{name}-fiche-sombre.png"))
        sheet.locator(".doc-sheet-close").click()
        card.locator(".doc-show").click()
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"beta36-{name}-montrer-sombre.png"))
        viewer.locator(".dv-close").click()

        # 8. Déconnexion : cache + file purgés.
        before = page.evaluate(IDB_COUNT)
        check(before["cache"] >= 2, f"{name}: documents en cache avant déconnexion ({before})")
        page.locator(TO_REGLAGES).first.click()
        page.locator("#btn-logout").click()
        with page.expect_navigation(timeout=10000):
            page.locator("#btn-logout-confirm").click()
        after = page.evaluate(IDB_COUNT)
        check(after == {"cache": 0, "queue": 0}, f"{name}: cache et file purgés à la déconnexion ({after})")

        # 9. Écran admin (lecture) : liste des chauffeurs -> documents.
        page.goto(f"{BASE}?demo=1&screen=documents-chauffeurs&role=admin&theme=clair", wait_until="load")
        owners = page.locator("#docs-admin-list .doc-owner")
        expect(owners).to_have_count(2, timeout=10000)
        page.screenshot(path=str(OUT / f"beta36-{name}-admin-clair.png"))
        owners.filter(has_text="Marc").click()
        expect(page.locator("#docs-admin-list .doc-card")).to_have_count(2, timeout=5000)
        check(page.locator("#docs-admin-list .doc-dot.is-soon").count() == 1, f"{name}: admin, pastille orange")
        page.locator("#docs-admin-list .doc-card .doc-show").first.click()
        expect(viewer.locator(".dv-img")).to_be_visible(timeout=5000)
        check(viewer.locator(".dv-delete").is_visible(), f"{name}: admin peut supprimer")
        viewer.locator(".dv-close").click()
        page.goto(f"{BASE}?demo=1&screen=documents-chauffeurs&role=admin&theme=sombre", wait_until="load")
        expect(owners).to_have_count(2, timeout=10000)
        owners.filter(has_text="Marc").click()
        expect(page.locator("#docs-admin-list .doc-card")).to_have_count(2, timeout=5000)
        page.screenshot(path=str(OUT / f"beta36-{name}-admin-sombre.png"))
        # Bureau sans rôle admin : redirigé vers « Mes documents ».
        page.goto(f"{BASE}?demo=1&screen=documents-chauffeurs&role=bureau", wait_until="load")
        expect(page.locator("#view-mes-documents")).to_be_visible(timeout=10000)
        check(page.locator("#view-documents-chauffeurs").is_hidden(), f"{name}: bureau sans admin refusé")
        # 10. Session expirée + aucun réseau : écran de connexion -> documents en cache
        #     montrables (lecture seule). Hors démo ; toute requête non locale bloquée
        #     (aucun appel à l'API réelle). Chromium seul (cf. émulation WebKit).
        if "webkit" not in name:
            page.route(lambda u: not u.startswith(BASE.split("/index.html")[0]), lambda r: r.abort())
            page.goto(BASE, wait_until="load")
            expect(page.locator("#screen-login")).to_be_visible(timeout=10000)
            check(page.locator("#btn-docs-offline").is_hidden(), f"{name}: accès hors ligne masqué en ligne")
            page.evaluate(SEED_CACHE)
            ctx.set_offline(True)
            page.evaluate("() => window.dispatchEvent(new Event('offline'))")
            expect(page.locator("#btn-docs-offline")).to_be_visible(timeout=5000)
            page.locator("#btn-docs-offline").click()
            expect(page.locator("#docs-offline-list .doc-card")).to_have_count(1, timeout=5000)
            page.locator("#docs-offline-list .doc-show").click()
            expect(page.locator("#doc-viewer .dv-img")).to_be_visible(timeout=5000)
            page.screenshot(path=str(OUT / f"beta36-{name}-connexion-hors-ligne-montrer.png"))
            page.locator("#doc-viewer .dv-close").click()
            ctx.set_offline(False)
            page.unroute_all()
        check(not errors, f"{name}: aucune erreur JS ({errors[:2]})")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"{name}: exception {exc}")
        print("  !!", exc)
        page.screenshot(path=str(OUT / f"beta36-{name}-ECHEC.png"))
    finally:
        page.close()


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    img = tmp / "carte-perspective.png"
    pdf = tmp / "attestation.pdf"
    make_card_png(img)
    make_pdf(pdf)
    with sync_playwright() as p:
        common = {"viewport": IPHONE, "is_mobile": True, "has_touch": True,
                  "service_workers": "block", **LOCALE}
        if WHICH in ("all", "webkit"):
            b = p.webkit.launch()
            ctx = b.new_context(user_agent=IOS_UA, device_scale_factor=3, **common)
            ctx.set_default_timeout(8000)
            run(ctx, "webkit-iphone", img, pdf)
            b.close()
        if WHICH in ("all", "chromium"):
            b = p.chromium.launch(args=["--lang=fr-FR"])
            ctx = b.new_context(device_scale_factor=2, **common)
            ctx.set_default_timeout(8000)
            run(ctx, "chromium", img, pdf)
            b.close()
    if failures:
        print("beta.36 documents KO :")
        for f in failures:
            print("  -", f)
        return 1
    print("OK : beta.36 Mes documents (WebKit + Chromium).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
