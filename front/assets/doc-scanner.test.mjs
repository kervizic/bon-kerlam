// Tests du « mode scanner » (beta.36) : détection des coins, homographie,
// redressement de perspective et amélioration du contraste sur image de test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectCorners, homography, warpPerspective, outputSize, enhance, otsu, quadArea,
  defaultCorners, fullCorners, downscale,
} from "./doc-scanner.js";

const QUAD = [{ x: 100, y: 60 }, { x: 520, y: 90 }, { x: 480, y: 350 }, { x: 80, y: 330 }];

function inside(q, x, y) {
  let c = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[i], b = q[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Fond sombre texturé + « carte » claire en perspective + bandeau noir (texte). */
function testImage(w = 600, h = 400) {
  const data = new Uint8ClampedArray(w * h * 4);
  const H = homography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], QUAD);
  const bar = [H.map(0.1, 0.4), H.map(0.9, 0.4), H.map(0.9, 0.55), H.map(0.1, 0.55)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let v = 45 + ((x * 7 + y * 13) % 11); // fond sombre légèrement bruité
      let col = [v, v + 5, v];
      if (inside(QUAD, x + 0.5, y + 0.5)) {
        v = 215 + ((x + y) % 7);
        col = [v, v, v - 10];
        if (inside(bar, x + 0.5, y + 0.5)) col = [20, 20, 30];
      }
      data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const lum = (img, x, y) => {
  const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
};

test("homographie : envoie exactement les 4 coins source sur les coins cible", () => {
  const dst = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }];
  const { map } = homography(QUAD, dst);
  QUAD.forEach((p, i) => {
    const q = map(p.x, p.y);
    assert.ok(Math.abs(q.x - dst[i].x) < 1e-6 && Math.abs(q.y - dst[i].y) < 1e-6);
  });
  assert.equal(homography([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], dst), null);
});

test("détection automatique des 4 coins de la carte (tolérance 2 % de la largeur)", () => {
  const img = testImage();
  const c = detectCorners(img);
  assert.ok(c, "coins détectés");
  c.forEach((p, i) => {
    const d = Math.hypot(p.x - QUAD[i].x, p.y - QUAD[i].y);
    assert.ok(d < 12, `coin ${i} : écart ${d.toFixed(1)} px`);
  });
});

test("détection : image uniforme ou sans document -> null (recadrage manuel)", () => {
  const w = 200, h = 150;
  const flat = { data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h };
  assert.equal(detectCorners(flat), null);
});

test("redressement : rectangle de sortie = carte à plat, bandeau à sa place", () => {
  const img = testImage();
  const out = warpPerspective(img, QUAD, { width: 420, height: 270 });
  assert.equal(out.width, 420);
  assert.equal(out.height, 270);
  // Coins et bords de la sortie : fond de carte clair (aucun fond sombre).
  for (const [x, y] of [[3, 3], [416, 3], [416, 266], [3, 266], [210, 20], [210, 250]]) {
    assert.ok(lum(out, x, y) > 180, `(${x},${y}) clair : ${lum(out, x, y)}`);
  }
  // Bandeau horizontal entre 40 % et 55 % de la hauteur, de 10 % à 90 % de la largeur.
  assert.ok(lum(out, 210, 270 * 0.47) < 60, "bandeau sombre au centre");
  assert.ok(lum(out, 210, 270 * 0.3) > 180, "clair au-dessus du bandeau");
  assert.ok(lum(out, 210, 270 * 0.7) > 180, "clair au-dessous du bandeau");
  // Bandeau horizontal : même luminosité à gauche et à droite (perspective corrigée).
  assert.ok(Math.abs(lum(out, 80, 270 * 0.47) - lum(out, 340, 270 * 0.47)) < 30);
});

test("taille de sortie : plus grand côté plafonné à 2000 px, jamais agrandi", () => {
  assert.deepEqual(outputSize(fullCorners(4000, 3000)), { width: 2000, height: 1500 });
  assert.deepEqual(outputSize(fullCorners(800, 500)), { width: 800, height: 500 });
});

test("contraste N&B : étirement des niveaux et image en gris", () => {
  const w = 50, h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const v = 110 + (p % w); // 110..159 : image terne
    data.set([v, v + 3, v - 3, 255], p * 4);
  }
  const img = enhance({ data, width: w, height: h }, "nb");
  const vals = [];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    assert.equal(img.data[i], img.data[i + 1]);
    assert.equal(img.data[i], img.data[i + 2]);
    vals.push(img.data[i]);
  }
  assert.ok(Math.min(...vals) < 15 && Math.max(...vals) > 240);
});

test("contraste couleur : étirement par canal, teinte conservée", () => {
  const w = 40, h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set([120 + (p % w), 80 + (p % w), 60, 255], p * 4);
  const img = enhance({ data, width: w, height: h }, "couleur");
  let maxR = 0, minR = 255;
  for (let p = 0; p < w * h; p++) { maxR = Math.max(maxR, img.data[p * 4]); minR = Math.min(minR, img.data[p * 4]); }
  assert.ok(maxR > 240 && minR < 15);
  assert.equal(img.data[2], 60, "canal plat (< 16 niveaux) inchangé");
});

test("utilitaires : Otsu, aire, coins par défaut, réduction", () => {
  const hist = new Array(256).fill(0);
  hist[30] = 100; hist[200] = 100;
  const t = otsu(hist);
  assert.ok(t >= 30 && t < 200);
  assert.equal(quadArea(fullCorners(10, 20)), 200);
  assert.equal(defaultCorners(100, 100)[0].x, 6);
  const s = downscale(testImage(), 128);
  assert.equal(Math.max(s.width, s.height), 128);
});
