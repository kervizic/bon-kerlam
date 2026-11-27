/* doc-scanner.js - « mode scanner » de Mes documents (beta.36).
 *
 * Calculs PURS sur des images { data: Uint8ClampedArray RGBA, width, height }
 * (forme d'un ImageData) : aucune dépendance, testables sous Node
 * (doc-scanner.test.mjs).
 *   - detectCorners : 4 coins du document (fond estimé sur le pourtour, masque par
 *     écart de couleur + seuil d'Otsu, plus grande composante connexe, extrêmes
 *     x+y / x-y). Renvoie null si rien de fiable : l'utilisateur ajuste à la main.
 *   - homography / warpPerspective : redressement de perspective (bilinéaire).
 *   - enhance : amélioration du contraste, « couleur » ou « nb » (noir & blanc).
 * Le câblage navigateur (canvas, export JPEG sans EXIF) vit dans scanToJpeg().
 */

export const EXPORT_SIDE = 2000;
export const DETECT_SIDE = 256;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Coins par défaut (léger retrait) quand la détection échoue. */
export function defaultCorners(w, h, inset = 0.06) {
  const dx = w * inset;
  const dy = h * inset;
  return [
    { x: dx, y: dy }, { x: w - dx, y: dy }, { x: w - dx, y: h - dy }, { x: dx, y: h - dy },
  ];
}

/** Coins de l'image entière (aucun recadrage). */
export function fullCorners(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

/** Réduction (moyenne par blocs) vers un plus petit côté ~max. */
export function downscale(img, max = DETECT_SIDE) {
  const k = Math.max(1, Math.max(img.width, img.height) / max);
  const w = Math.max(1, Math.round(img.width / k));
  const h = Math.max(1, Math.round(img.height / k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * k);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * k);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * k)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h, scale: k };
}

/** Seuil d'Otsu sur un histogramme 256 classes. */
export function otsu(hist) {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  let wB = 0, sumB = 0, best = 0, t = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t;
}

function median(a) {
  const s = Array.from(a).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
}

/**
 * Détection automatique des 4 coins (ordre : haut-gauche, haut-droit, bas-droit,
 * bas-gauche), en coordonnées de l'image d'origine. null si non fiable.
 */
export function detectCorners(img) {
  const s = downscale(img);
  const { width: w, height: h, data } = s;
  if (w < 16 || h < 16) return null;
  // Fond = médiane des pixels du pourtour (bande de 2 px).
  const br = [], bg = [], bb = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > 1 && y > 1 && x < w - 2 && y < h - 2) continue;
      const i = (y * w + x) * 4;
      br.push(data[i]); bg.push(data[i + 1]); bb.push(data[i + 2]);
    }
  }
  const bgc = [median(br), median(bg), median(bb)];
  const dist = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const d = Math.sqrt(
      (data[i] - bgc[0]) ** 2 + (data[i + 1] - bgc[1]) ** 2 + (data[i + 2] - bgc[2]) ** 2) / Math.sqrt(3);
    dist[p] = d;
    hist[dist[p]]++;
  }
  const t = Math.max(18, otsu(hist));
  // Plus grande composante connexe (4-voisinage) du masque « différent du fond ».
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestSize = 0;
  const stack = new Int32Array(w * h);
  let id = 0;
  for (let p0 = 0; p0 < w * h; p0++) {
    if (dist[p0] <= t || label[p0] !== -1) continue;
    let sp = 0, size = 0;
    stack[sp++] = p0;
    label[p0] = id;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && label[q] === -1 && dist[q] > t) { label[q] = id; stack[sp++] = q; }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const ratio = bestSize / (w * h);
  if (bestId < 0 || ratio < 0.12 || ratio > 0.97) return null;
  // Coins = extrêmes de x+y et x-y sur la composante retenue.
  let tl = null, tr = null, brc = null, bl = null;
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  for (let p = 0; p < w * h; p++) {
    if (label[p] !== bestId) continue;
    const x = p % w, y = (p / w) | 0;
    const sum = x + y, dif = x - y;
    if (sum < minS) { minS = sum; tl = { x, y }; }
    if (sum > maxS) { maxS = sum; brc = { x: x + 1, y: y + 1 }; }
    if (dif > maxD) { maxD = dif; tr = { x: x + 1, y }; }
    if (dif < minD) { minD = dif; bl = { x, y: y + 1 }; }
  }
  const k = s.scale;
  const quad = [tl, tr, brc, bl].map((c) => ({
    x: clamp(c.x * k, 0, img.width), y: clamp(c.y * k, 0, img.height),
  }));
  // Quadrilatère dégénéré (aire trop faible) : non fiable.
  if (quadArea(quad) < 0.1 * img.width * img.height) return null;
  return quad;
}

export function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Taille de sortie : côtés max du quadrilatère, plus grand côté <= max (sans agrandir). */
export function outputSize(quad, max = EXPORT_SIDE) {
  const w = Math.max(dist2(quad[0], quad[1]), dist2(quad[3], quad[2]));
  const h = Math.max(dist2(quad[0], quad[3]), dist2(quad[1], quad[2]));
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Résout A x = b (8x8) par élimination de Gauss avec pivot partiel. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Homographie H (3x3, h33 = 1) envoyant src[i] -> dst[i]. Renvoie
 * fonction (x, y) -> {x, y} et les 9 coefficients.
 */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  const H = [...h, 1];
  const map = (x, y) => {
    const z = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / z, y: (H[3] * x + H[4] * y + H[5]) / z };
  };
  return { H, map };
}

/** Redresse le quadrilatère `quad` de `img` en un rectangle out.width x out.height. */
export function warpPerspective(img, quad, out = outputSize(quad)) {
  const { width: W, height: Hh } = out;
  const dstRect = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Hh }, { x: 0, y: Hh }];
  const hm = homography(dstRect, quad); // sortie -> source (échantillonnage inverse)
  if (!hm) throw new Error("Recadrage impossible (coins alignés).");
  const H = hm.H;
  const src = img.data, sw = img.width, sh = img.height;
  const data = new Uint8ClampedArray(W * Hh * 4);
  for (let y = 0; y < Hh; y++) {
    const yc = y + 0.5;
    for (let x = 0; x < W; x++) {
      const xc = x + 0.5;
      const z = H[6] * xc + H[7] * yc + H[8];
      let sx = (H[0] * xc + H[1] * yc + H[2]) / z - 0.5;
      let sy = (H[3] * xc + H[4] * yc + H[5]) / z - 0.5;
      sx = clamp(sx, 0, sw - 1);
      sy = clamp(sy, 0, sh - 1);
      const x0 = sx | 0, y0 = sy | 0;
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
        data[o + c] = top + (bot - top) * fy;
      }
      data[o + 3] = 255;
    }
  }
  return { data, width: W, height: Hh };
}

/** Percentiles bas/haut d'un histogramme. */
function percentiles(hist, total, lo = 0.01, hi = 0.99) {
  let acc = 0, a = 0, b = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * lo) { a = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * (1 - hi)) { b = i; break; } }
  return b - a < 16 ? [0, 255] : [a, b];
}

/**
 * Amélioration du contraste (en place, renvoie img).
 *  - "couleur" : étirement des niveaux par canal (1 %-99 %) ;
 *  - "nb"      : niveaux de gris, étirement + courbe (fond blanchi, texte foncé).
 */
export function enhance(img, mode = "couleur") {
  const d = img.data;
  const n = img.width * img.height;
  if (mode === "nb") {
    const hist = new Array(256).fill(0);
    const g = new Uint8ClampedArray(n);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      hist[g[p]]++;
    }
    const [a, b] = percentiles(hist, n, 0.02, 0.9);
    for (let p = 0; p < n; p++) {
      let v = clamp((g[p] - a) / (b - a), 0, 1);
      v = v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v); // courbe en S
      const i = p * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255);
    }
    return img;
  }
  for (let c = 0; c < 3; c++) {
    const hist = new Array(256).fill(0);
    for (let p = 0; p < n; p++) hist[d[p * 4 + c]]++;
    const [a, b] = percentiles(hist, n);
    const k = 255 / (b - a);
    for (let p = 0; p < n; p++) {
      const i = p * 4 + c;
      d[i] = clamp((d[i] - a) * k, 0, 255);
    }
  }
  return img;
}

/* ------------------------------------------------------------ Navigateur -- */

const WORK_SIDE = 3000; // image source ramenée à 3000 px avant recadrage (mémoire iOS)

/** Fichier image -> ImageData de travail (orientation EXIF appliquée). */
export async function fileToImageData(file, max = WORK_SIDE) {
  let src;
  if (typeof createImageBitmap === "function") {
    try {
      src = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      src = null;
    }
  }
  if (!src) {
    const url = URL.createObjectURL(file);
    try {
      src = new Image();
      src.src = url;
      await src.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (typeof src.close === "function") src.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** ImageData -> canvas. */
export function toCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const id = c.getContext("2d").createImageData(img.width, img.height);
  id.data.set(img.data);
  c.getContext("2d").putImageData(id, 0, 0);
  return c;
}
