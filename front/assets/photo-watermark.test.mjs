/* photo-watermark.test.mjs — partie pure du filigrane des photos de ligne (beta.35). */
import test from "node:test";
import assert from "node:assert/strict";
import { formatStamp, formatGps, watermarkLines, fitSize, typeLabel, MAX_SIDE } from "./photo-watermark.js";

test("formatStamp : JJ/MM/AAAA HH:MM en heure locale", () => {
  assert.equal(formatStamp(new Date(2026, 10, 27, 9, 5)), "27/11/2026 09:05");
  assert.equal(formatStamp(new Date(2026, 0, 3, 23, 59)), "03/01/2026 23:59");
});

test("formatGps : coordonnées + précision, ou « GPS indisponible »", () => {
  assert.equal(formatGps({ lat: 48.856613, lng: 2.352222, accuracy: 12.4 }), "48.85661, 2.35222 (±12 m)");
  assert.equal(formatGps({ lat: 48.8, lng: 2.3 }), "48.80000, 2.30000");
  assert.equal(formatGps(null), "GPS indisponible");
  assert.equal(formatGps({ lat: NaN, lng: 2 }), "GPS indisponible");
});

test("watermarkLines : type + numéro, puis date · GPS", () => {
  const d = new Date(2026, 10, 27, 14, 5);
  assert.deepEqual(
    watermarkLines({ type: "avant", numero: "KER-03003", takenAt: d, gps: { lat: 1, lng: 2, accuracy: 5 } }),
    ["Avant · KER-03003", "27/11/2026 14:05 · 1.00000, 2.00000 (±5 m)"],
  );
  // Brouillon sans numéro, GPS refusé.
  assert.deepEqual(
    watermarkLines({ type: "apres", numero: null, takenAt: d, gps: null }),
    ["Après", "27/11/2026 14:05 · GPS indisponible"],
  );
  assert.equal(typeLabel("apres"), "Après");
  assert.equal(typeLabel("avant"), "Avant");
});

test("fitSize : ~1600 px côté long, ratio conservé, jamais d'agrandissement", () => {
  assert.equal(MAX_SIDE, 1600);
  assert.deepEqual(fitSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(4000, 3000, 320), { width: 320, height: 240 });
  assert.deepEqual(fitSize(0, 10), { width: 0, height: 0 });
});

test("stripJpegApp1 : retire EXIF/XMP (APP1), garde le reste", async () => {
  const { stripJpegApp1 } = await import("./photo-watermark.js");
  const seg = (m, payload) => [0xff, m, 0, payload.length + 2, ...payload];
  const exif = [...Buffer.from("Exif\0\0GPS-SECRET")];
  const jpeg = Uint8Array.from([
    0xff, 0xd8, ...seg(0xe0, [1, 2, 3]), ...seg(0xe1, exif), ...seg(0xdb, [9, 9]),
    0xff, 0xda, 0, 4, 7, 7, 0x11, 0x22, 0xff, 0xd9,
  ]);
  const out = stripJpegApp1(jpeg);
  assert.equal(Buffer.from(out).includes(Buffer.from("GPS-SECRET")), false);
  assert.deepEqual(Array.from(out), [
    0xff, 0xd8, ...seg(0xe0, [1, 2, 3]), ...seg(0xdb, [9, 9]),
    0xff, 0xda, 0, 4, 7, 7, 0x11, 0x22, 0xff, 0xd9,
  ]);
  // Non-JPEG : inchangé.
  assert.deepEqual(Array.from(stripJpegApp1(Uint8Array.from([1, 2, 3]))), [1, 2, 3]);
});
