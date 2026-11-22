/* signature-pad.test.mjs — géométrie de l'export de signature (beta.33.2). */
import test from "node:test";
import assert from "node:assert/strict";
import { strokesBBox, fitContain, exportLayout } from "./signature-pad.js";

test("strokesBBox : englobe tous les points, null si vide", () => {
  assert.equal(strokesBBox([]), null);
  assert.equal(strokesBBox([[]]), null);
  const b = strokesBBox([[{ x: 10, y: 20 }, { x: 50, y: 5 }], [{ x: 30, y: 90 }]]);
  assert.deepEqual(b, { minX: 10, minY: 5, maxX: 50, maxY: 90 });
});

test("fitContain : échelle « contain »", () => {
  assert.equal(fitContain(100, 100, 200, 100), 1);   // limité par la hauteur
  assert.equal(fitContain(400, 100, 200, 100), 0.5);  // limité par la largeur
  assert.equal(fitContain(0, 10, 200, 100), 1);       // garde-fou division par zéro
});

test("exportLayout : sortie au ratio 2:1 exact, tracé centré", () => {
  const b = { minX: 100, minY: 100, maxX: 300, maxY: 150 }; // 200 x 50
  const lay = exportLayout(b, { margin: 0, outW: 1200, ratio: 2 });
  assert.equal(lay.outW, 1200);
  assert.equal(lay.outH, 600);                 // 2:1 exact
  assert.equal(lay.outW / lay.outH, 2);
  // Le centre du tracé tombe au centre de la sortie.
  assert.ok(Math.abs(lay.tx(200) - 600) < 1e-6);  // cx=200 -> outW/2
  assert.ok(Math.abs(lay.ty(125) - 300) < 1e-6);  // cy=125 -> outH/2
  // contain : 200 de large tient dans 1200 -> scale limité par... 1200/200=6, 600/50=12 -> 6
  assert.equal(lay.scale, 6);
  // Les extrémités restent dans la sortie.
  assert.ok(lay.tx(100) >= 0 && lay.tx(300) <= 1200);
});

test("exportLayout : bbox null -> sortie 2:1 neutre", () => {
  const lay = exportLayout(null, { outW: 1200, ratio: 2 });
  assert.equal(lay.outW, 1200);
  assert.equal(lay.outH, 600);
});
