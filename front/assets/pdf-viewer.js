/* pdf-viewer.js — visionneuse PDF INTÉGRÉE plein écran (beta.21).
 *
 * But : afficher le PDF d'une lettre DANS l'app (canvas pdf.js), au lieu
 * d'ouvrir un nouvel onglet / un téléchargement — comportements bridés par iOS
 * Safari et la PWA installée. pdf.js est embarqué LOCALEMENT (front/assets/
 * vendor/pdfjs), worker local, aucun appel réseau tiers.
 *
 * API : renderPdfInto(blob, hostEl) rend toutes les pages (ajustées à la
 * largeur) dans hostEl. L'overlay, le bouton « Télécharger » et la croix de
 * fermeture sont gérés par app.js (balisage statique dans index.html).
 */
"use strict";

import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs?v=21";

// Worker local (jamais de CDN) — chemin absolu servi par nginx.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/pdf.worker.mjs?v=21";

let renderToken = 0;

/** Rend le PDF (Blob) dans hostEl (vidé au préalable). Pages empilées,
 *  ajustées à la largeur du conteneur, nettes sur écran Retina (DPR ≤ 2). */
export async function renderPdfInto(blob, hostEl) {
  const myToken = ++renderToken; // annule un rendu précédent encore en cours
  hostEl.innerHTML = '<p class="pdf-viewer-loading">Chargement du PDF…</p>';
  let pdf;
  try {
    const data = new Uint8Array(await blob.arrayBuffer());
    pdf = await pdfjsLib.getDocument({ data }).promise;
  } catch (e) {
    if (myToken === renderToken) {
      hostEl.innerHTML = '<p class="pdf-viewer-error">Aperçu indisponible. Utilisez « Télécharger ».</p>';
    }
    return;
  }
  if (myToken !== renderToken) return;
  hostEl.innerHTML = "";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hostWidth = () => Math.max(1, hostEl.clientWidth || hostEl.offsetWidth || window.innerWidth);
  for (let p = 1; p <= pdf.numPages; p++) {
    if (myToken !== renderToken) return;
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = (hostWidth() / base.width) * dpr;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-viewer-page";
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    hostEl.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  }
}
