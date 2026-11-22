/* signature-pad.js — géométrie PURE du cadre de signature (beta.33.2), testable sans
 * DOM/canvas. L'export convertit le tracé en NOIR, recadré sur le dessin puis remis
 * au ratio 2:1 exact ; le rendu à l'écran garde la couleur du thème (dans app.js). */
"use strict";

/** Boîte englobante de tous les points des tracés, ou null si vide. */
export function strokesBBox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const s of strokes || []) {
    for (const p of s || []) {
      any = true;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/** Facteur d'échelle « contain » pour loger (cw × ch) dans (outW × outH). */
export function fitContain(cw, ch, outW, outH) {
  if (cw <= 0 || ch <= 0) return 1;
  return Math.min(outW / cw, outH / ch);
}

/** Paramètres d'export : recadrage (bbox + marge) rééchelonné et centré dans un
 * canevas de ratio `ratio:1` (2:1). Renvoie la transformation point -> pixel de sortie. */
export function exportLayout(bbox, { margin = 24, outW = 1200, ratio = 2 } = {}) {
  const outH = Math.round(outW / ratio);
  if (!bbox) return { outW, outH, scale: 1, cx: 0, cy: 0 };
  const cw = (bbox.maxX - bbox.minX) + margin * 2;
  const ch = (bbox.maxY - bbox.minY) + margin * 2;
  const scale = fitContain(cw, ch, outW, outH);
  return {
    outW, outH, scale,
    cx: (bbox.minX + bbox.maxX) / 2,
    cy: (bbox.minY + bbox.maxY) / 2,
    // point (x,y) CSS -> pixel sortie
    tx: (x) => (x - (bbox.minX + bbox.maxX) / 2) * scale + outW / 2,
    ty: (y) => (y - (bbox.minY + bbox.maxY) / 2) * scale + outH / 2,
  };
}
