/* photo-watermark.js — filigrane des photos de ligne (beta.35).
 *
 * Partie PURE (testée sous Node, cf. photo-watermark.test.mjs) : texte du
 * filigrane, format date/heure locale, dimensions cibles.
 * Partie NAVIGATEUR : décodage de l'image (orientation EXIF appliquée), dessin
 * sur canvas redimensionné (~1600 px côté long), bandeau semi-opaque en bas,
 * export JPEG 0,8. Le ré-encodage canvas SUPPRIME toutes les métadonnées EXIF
 * d'origine (GPS du téléphone, modèle...) : aucune fuite. Les coordonnées utiles
 * sont conservées en base (taken_at / lat / lng / accuracy_m), pas dans le fichier.
 */

export const MAX_SIDE = 1600;
export const THUMB_SIDE = 320;
export const JPEG_QUALITY = 0.8;

const pad = (n) => String(n).padStart(2, "0");

/** JJ/MM/AAAA HH:MM en heure locale de l'appareil. */
export function formatStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Coordonnées lisibles (5 décimales ≈ 1 m) ou « GPS indisponible ». */
export function formatGps(pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return "GPS indisponible";
  const acc = Number.isFinite(pos.accuracy) ? ` (±${Math.round(pos.accuracy)} m)` : "";
  return `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}${acc}`;
}

export function typeLabel(type) {
  return type === "apres" ? "Après" : "Avant";
}

/** Deux lignes de filigrane : [« Avant · KER-03003 », « 27/11/2026 14:05 · 48.85661, 2.35222 (±12 m) »]. */
export function watermarkLines({ type, numero, takenAt, gps }) {
  const first = [typeLabel(type), numero || null].filter(Boolean).join(" · ");
  return [first, `${formatStamp(takenAt)} · ${formatGps(gps)}`];
}

/** Dimensions cibles en conservant le ratio ; jamais d'agrandissement. */
export function fitSize(w, h, max = MAX_SIDE) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * Retire les segments APP1 (EXIF / XMP) d'un JPEG. Certains moteurs (WebKit)
 * réécrivent un bloc EXIF minimal à l'encodage canvas : on l'ôte pour garantir
 * un fichier sans aucune métadonnée. Renvoie les octets inchangés si le flux
 * n'est pas un JPEG reconnu.
 */
export function stripJpegApp1(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return b;
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break; // début des données image (SOS) : on garde tout le reste
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return b; // flux inattendu : inchangé
    if (marker !== 0xe1) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  parts.push(b.subarray(i));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ------------------------------------------------------------ Navigateur -- */

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function loadImg(src) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

async function decode(file) {
  // createImageBitmap applique l'orientation EXIF (photos iPhone en portrait).
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      /* repli <img> ci-dessous (anciens WebKit) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await loadImg(url);
  } catch (e) {
    // Dernier repli : data: URL (aucun chargement réseau, même hors ligne).
    return loadImg(await blobToDataUrl(file));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function toBlob(canvas, quality = JPEG_QUALITY) {
  const raw = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encodage JPEG impossible"))), "image/jpeg", quality);
  });
  return new Blob([stripJpegApp1(new Uint8Array(await raw.arrayBuffer()))], { type: "image/jpeg" });
}

function drawBand(ctx, width, height, lines) {
  const fs = Math.max(14, Math.round(Math.min(width, height) * 0.032));
  const lh = Math.round(fs * 1.3);
  const padY = Math.round(fs * 0.6);
  const padX = Math.round(fs * 0.8);
  const bandH = lh * lines.length + padY * 2;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)"; // bandeau semi-opaque : lisible sur fond clair ET sombre
  ctx.fillRect(0, height - bandH, width, bandH);
  ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = Math.round(fs / 6);
  lines.forEach((line, i) => {
    ctx.fillText(line, padX, height - bandH + padY + i * lh, width - padX * 2);
  });
  ctx.shadowBlur = 0;
}

/**
 * Filigrane + redimensionnement + export. Renvoie { blob, thumb, width, height }.
 * `meta` : { type, numero, takenAt, gps }.
 */
export async function watermarkImage(file, meta) {
  const src = await decode(file);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  const { width, height } = fitSize(sw, sh, MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(src, 0, 0, width, height);
  if (typeof src.close === "function") src.close();
  drawBand(ctx, width, height, watermarkLines(meta));
  const blob = await toBlob(canvas);
  // Miniature dérivée de l'image FILIGRANÉE (le bandeau reste visible en vignette).
  const t = fitSize(width, height, THUMB_SIDE);
  const tc = document.createElement("canvas");
  tc.width = t.width;
  tc.height = t.height;
  tc.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
  const thumb = await toBlob(tc, 0.7);
  canvas.width = canvas.height = 0; // libère la mémoire (iOS)
  tc.width = tc.height = 0;
  return { blob, thumb, width, height };
}

/** Position GPS bornée dans le temps ; null si refusée / indisponible. */
export function getGps(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/** Canvas -> JPEG sans EXIF/XMP (réutilisé par le mode scanner, beta.36). */
export { toBlob as toJpegBlob };
