/* my-documents.js - « Mes documents » (beta.36) : UI.
 *
 * Écran « Mes documents » (cartes avec miniature, expiration + pastille discrète,
 * bouton « Montrer »), feuille d'ajout / modification (enregistrement immédiat,
 * pas de bouton de validation), mode scanner (coins détectés automatiquement puis
 * ajustables, redressement, contraste couleur / N&B, JPEG ~2000 px sans EXIF),
 * visionneuse plein écran (zoom pincé), écran admin en lecture.
 *
 * Hors ligne : les documents du propriétaire sont conservés localement
 * (IndexedDB « bon-docs-cache ») pour être montrés sans réseau ; ajouts,
 * modifications et suppressions passent par une file (IndexedDB
 * « bon-docs-queue », photo-queue.js) envoyée au retour du réseau. Les deux sont
 * PURGÉS à la déconnexion (purgeLocal). Aucun rappel ni notification.
 */

import {
  DOC_TYPES, docTitle, typeLabel, expiryStatus, formatDateFr, filePath, thumbOf, isPdfPath,
  rowOf, sortDocs, wantedFiles, syncCache, mergeDocs, purgeLocal as purgeStores,
} from "./doc-store.js?v=360";
import { createPhotoQueue, idbStore, memoryStore } from "./photo-queue.js?v=360";
import {
  detectCorners, defaultCorners, fullCorners, warpPerspective, outputSize, enhance,
  fileToImageData, toCanvas,
} from "./doc-scanner.js?v=360";
import { toJpegBlob, blobToDataUrl } from "./photo-watermark.js?v=360";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const THUMB_SIDE = 360;

function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_FILE = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';
const ICON_PENDING = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';
const ICON_EYE = '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';

/**
 * api : { list(ownerId?), send(op), signedUrls(paths), owners() }
 * getContext() : { email, userId, isAdmin }
 */
export function createMyDocuments({ api, getContext, demo = false, onError = () => {} }) {
  const hasIdb = typeof indexedDB !== "undefined";
  const cache = hasIdb ? idbStore(demo ? "bon-docs-cache-demo" : "bon-docs-cache", "docs") : memoryStore();
  const queueStore = hasIdb ? idbStore(demo ? "bon-docs-queue-demo" : "bon-docs-queue", "queue") : memoryStore();
  let docs = []; // liste affichée (écran « Mes documents »)
  let rendering = null;

  const owner = () => String((getContext().email || "")).toLowerCase();

  const queue = createPhotoQueue({
    store: queueStore,
    upload: api.send,
    onChange: async (ev) => {
      if (ev.sent) {
        const op = ev.sent;
        try {
          if (op.kind === "delete") await cache.delete(op.docId);
          else {
            const prev = await cache.get(op.docId);
            await cache.put({
              id: op.docId, owner: op.owner || owner(), row: { ...(prev ? prev.row : {}), ...op.row },
              files: { ...(prev ? prev.files : {}), ...(op.files || {}) },
            });
          }
        } catch (e) { /* cache indisponible : affichage serveur au prochain chargement */ }
      }
      if (ev.sent || ev.dropped) scheduleRender();
    },
    onDrop: (op, err) => onError(`Document non envoyé : ${(err && err.message) || "refusé"}`),
  });

  /* --------------------------------------------------------- données -- */
  async function localList() {
    let cached = [];
    let ops = [];
    try { cached = await cache.getAll(); } catch (e) { cached = []; }
    try { ops = await queue.list(); } catch (e) { ops = []; }
    return mergeDocs(cached, ops, owner());
  }

  async function fetchFiles(paths) {
    const urls = await api.signedUrls(paths);
    const out = {};
    await Promise.all(Object.entries(urls || {}).map(async ([p, url]) => {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) out[p] = await r.blob();
    }));
    return out;
  }

  /** Affiche d'abord le local (immédiat, hors ligne), puis aligne sur le serveur. */
  async function load() {
    docs = await localList();
    render();
    try {
      const rows = await api.list(null);
      await syncCache({ cache, rows, owner: owner(), fetchFiles });
      docs = await localList();
      render();
    } catch (e) {
      /* hors ligne : on reste sur le cache local */
    }
    queue.flush().catch(() => {});
  }

  function scheduleRender() {
    if (rendering) return;
    rendering = setTimeout(async () => {
      rendering = null;
      docs = await localList();
      render();
      if (sheet.docId) syncSheetFromDocs();
    }, 30);
  }

  async function enqueue(op) {
    const full = { id: uuid(), owner: owner(), queuedAt: new Date().toISOString(), ...op };
    try {
      await queue.enqueue(full);
    } catch (e) {
      onError("Stockage local indisponible.");
    }
    scheduleRender();
  }

  /* ------------------------------------------------------------ rendu -- */
  // Images locales en data: URL (pas d'URL objet à révoquer ; s'affichent hors
  // ligne dans tous les moteurs). `src` : URL (signée) ou Blob local.
  function setImgSrc(img, src) {
    if (!src) return;
    if (typeof src === "string") { img.src = src; return; }
    blobToDataUrl(src).then((u) => { img.src = u; }).catch(() => {});
  }

  function expiryHtml(doc) {
    if (!doc.expiration) return "";
    const st = expiryStatus(doc.expiration);
    const dot = st === "expired" || st === "soon"
      ? `<span class="doc-dot is-${st}" aria-hidden="true"></span>` : "";
    const sr = st === "expired" ? " (expiré)" : st === "soon" ? " (expire bientôt)" : "";
    return `<span class="doc-exp" data-status="${st || ""}">${dot}Exp. ${formatDateFr(doc.expiration)}<span class="visually-hidden">${sr}</span></span>`;
  }

  function thumbNode(doc, urlFor) {
    const box = document.createElement("span");
    box.className = "doc-thumb";
    const p = doc.recto_path;
    if (isPdfPath(p)) {
      box.innerHTML = `${svg(ICON_FILE)}<span>PDF</span>`;
      box.classList.add("is-pdf");
      return box;
    }
    const src = urlFor(thumbOf(p)) || urlFor(p);
    if (src) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      setImgSrc(img, src);
      box.appendChild(img);
    } else {
      box.innerHTML = svg(ICON_FILE);
    }
    return box;
  }

  function cardNode(doc, { urlFor, editable, onShow, onEdit }) {
    const card = document.createElement("article");
    card.className = "doc-card" + (doc.pending ? " is-pending" : "");
    card.dataset.docId = doc.id;
    card.dataset.type = doc.type;
    const main = document.createElement(editable ? "button" : "div");
    if (editable) main.type = "button";
    main.className = "doc-card-main";
    main.appendChild(thumbNode(doc, urlFor));
    const txt = document.createElement("span");
    txt.className = "doc-card-text";
    const title = document.createElement("strong");
    title.textContent = docTitle(doc);
    txt.appendChild(title);
    const meta = document.createElement("span");
    meta.className = "doc-card-meta";
    meta.innerHTML = expiryHtml(doc);
    if (doc.numero) {
      const n = document.createElement("span");
      n.className = "doc-num";
      n.textContent = `N° ${doc.numero}`;
      meta.appendChild(n);
    }
    if (doc.pending) meta.insertAdjacentHTML("beforeend", `<span class="doc-pending" title="En attente d'envoi">${svg(ICON_PENDING)}</span>`);
    txt.appendChild(meta);
    main.appendChild(txt);
    if (editable) main.addEventListener("click", () => onEdit(doc));
    else main.addEventListener("click", () => onShow(doc));
    const show = document.createElement("button");
    show.type = "button";
    show.className = "btn btn-secondary doc-show";
    show.innerHTML = `${svg(ICON_EYE)}<span>Montrer</span>`;
    show.addEventListener("click", () => onShow(doc));
    card.append(main, show);
    return card;
  }

  function localUrlFor(doc) {
    return (p) => (p && doc.files && doc.files[p]) || null;
  }

  function render() {
    const host = document.getElementById("docs-list");
    if (!host) return;
    host.textContent = "";
    const empty = document.getElementById("docs-empty");
    if (empty) empty.hidden = docs.length > 0;
    for (const doc of docs) {
      host.appendChild(cardNode(doc, {
        urlFor: localUrlFor(doc), editable: true,
        onShow: (d) => openViewer(d, { files: d.files, canDelete: false }),
        onEdit: (d) => openSheet(d),
      }));
    }
  }

  /* ------------------------------------------------- feuille d'édition -- */
  const sheet = { el: null, docId: null, draft: null, exists: false, side: null, timer: null };

  function openSheet(doc = null) {
    const el = document.getElementById("doc-sheet");
    if (!el) return;
    sheet.el = el;
    sheet.exists = !!doc;
    sheet.docId = doc ? doc.id : uuid();
    sheet.draft = doc
      ? { ...rowOf(doc), files: { ...(doc.files || {}) } }
      : { id: sheet.docId, type: "permis", libelle: null, numero: null, expiration: null,
        recto_path: null, verso_path: null, files: {} };
    fillSheet();
    el.hidden = false;
  }

  function closeSheet() {
    flushFields();
    if (sheet.el) sheet.el.hidden = true;
    sheet.docId = null;
    sheet.draft = null;
  }

  function syncSheetFromDocs() {
    const d = docs.find((x) => x.id === sheet.docId);
    if (!d || !sheet.draft) return;
    sheet.exists = true;
    sheet.draft.files = { ...d.files, ...sheet.draft.files };
    renderFaces();
  }

  function fillSheet() {
    const el = sheet.el;
    const d = sheet.draft;
    el.querySelector("#doc-sheet-title").textContent = sheet.exists ? docTitle(d) : "Nouveau document";
    el.querySelectorAll('input[name="doc-type"]').forEach((r) => { r.checked = r.value === d.type; });
    el.querySelector("#doc-libelle").value = d.libelle || "";
    el.querySelector("#doc-numero").value = d.numero || "";
    el.querySelector("#doc-expiration").value = d.expiration || "";
    el.querySelector("#btn-doc-delete").hidden = !sheet.exists;
    updateLibelleField();
    renderFaces();
  }

  function updateLibelleField() {
    const t = sheet.draft.type;
    const wrap = sheet.el.querySelector("#doc-libelle-field");
    wrap.hidden = !(t === "caces" || t === "autre");
    wrap.querySelector("label").textContent = t === "caces" ? "Catégorie (ex. R482 cat. A)" : "Libellé";
  }

  function renderFaces() {
    const d = sheet.draft;
    if (!d || !sheet.el) return;
    const faceUrl = (q) => (q && d.files[q]) || null;
    for (const side of ["recto", "verso"]) {
      const slot = sheet.el.querySelector(`.doc-face[data-side="${side}"]`);
      const prev = slot.querySelector(".doc-face-preview");
      prev.textContent = "";
      const p = d[`${side}_path`];
      if (p) {
        const fake = { recto_path: p, files: d.files };
        prev.appendChild(thumbNode(fake, faceUrl));
      } else {
        prev.innerHTML = `<span class="doc-thumb is-empty">${svg('<path d="M12 5v14M5 12h14"/>')}</span>`;
      }
      slot.classList.toggle("has-file", !!p);
      const rm = slot.querySelector(".doc-face-remove");
      if (rm) rm.hidden = !p;
    }
  }

  /** Enregistre le brouillon (file d'envoi) dès qu'il a un recto. */
  async function persist(newFiles = {}) {
    const d = sheet.draft;
    if (!d || !d.recto_path) return;
    const files = {};
    for (const [k, v] of Object.entries(newFiles)) files[k] = v;
    sheet.exists = true;
    sheet.el.querySelector("#btn-doc-delete").hidden = false;
    sheet.el.querySelector("#doc-sheet-title").textContent = docTitle(d);
    await enqueue({ kind: "upsert", docId: d.id, row: rowOf(d), files });
  }

  function readFields() {
    const el = sheet.el;
    const d = sheet.draft;
    const t = el.querySelector('input[name="doc-type"]:checked');
    d.type = t ? t.value : d.type;
    d.libelle = (d.type === "caces" || d.type === "autre") ? (el.querySelector("#doc-libelle").value.trim() || null) : null;
    d.numero = el.querySelector("#doc-numero").value.trim() || null;
    d.expiration = el.querySelector("#doc-expiration").value || null;
  }

  function flushFields() {
    if (!sheet.timer) return;
    clearTimeout(sheet.timer);
    sheet.timer = null;
    persist();
  }

  function onFieldChange(immediate) {
    if (!sheet.draft) return;
    readFields();
    updateLibelleField();
    clearTimeout(sheet.timer);
    sheet.timer = null;
    if (immediate) persist();
    else sheet.timer = setTimeout(() => { sheet.timer = null; persist(); }, 700);
  }

  async function setFace(side, { blob, thumb, ext }) {
    const d = sheet.draft;
    const { userId } = getContext();
    if (userId == null) { onError("Profil indisponible."); return; }
    readFields();
    const path = filePath(userId, d.id, uuid(), ext);
    const files = { [path]: blob };
    if (thumb) files[thumbOf(path)] = thumb;
    d[`${side}_path`] = path;
    Object.assign(d.files, files);
    renderFaces();
    if (!d.recto_path) return; // verso seul : enregistré avec le recto
    // Fichiers du verso pris avant le recto : envoyés avec le premier enregistrement.
    const extra = {};
    if (side === "recto" && d.verso_path && !sheet.exists) {
      for (const p of [d.verso_path, thumbOf(d.verso_path)]) if (p && d.files[p]) extra[p] = d.files[p];
    }
    await persist({ ...extra, ...files });
  }

  async function removeVerso() {
    const d = sheet.draft;
    if (!d.verso_path) return;
    d.verso_path = null;
    renderFaces();
    await persist();
  }

  async function deleteDoc() {
    const d = sheet.draft;
    if (!d || !window.confirm("Supprimer ce document ?")) return;
    const id = d.id;
    clearTimeout(sheet.timer);
    sheet.timer = null;
    const existed = sheet.exists;
    // Opérations encore en file pour ce document : inutiles. La suppression est
    // toujours envoyée (sans effet si le document n'avait pas encore atteint le
    // serveur : idempotente), ce qui couvre un envoi en cours au même moment.
    try {
      for (const o of (await queue.list()).filter((x) => x.docId === id)) await queue.remove(o.id);
    } catch (e) { /* file indisponible */ }
    if (sheet.el) sheet.el.hidden = true;
    sheet.docId = null;
    sheet.draft = null;
    if (existed) await enqueue({ kind: "delete", docId: id });
    else scheduleRender();
  }

  /* ------------------------------------------------------ prise de vue -- */
  let captureSide = null;

  function pick(side, kind) {
    captureSide = side;
    const input = document.getElementById(`doc-input-${kind}`);
    if (!input) return;
    input.value = "";
    input.click(); // dans le geste utilisateur (iOS)
  }

  async function onFileChosen(file, kind) {
    const side = captureSide;
    captureSide = null;
    if (!file || !side || !sheet.draft) return;
    if (kind === "pdf" || file.type === "application/pdf") {
      if (file.size > MAX_PDF_BYTES) { onError("PDF trop volumineux (10 Mo maximum)."); return; }
      const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
      await setFace(side, { blob, thumb: null, ext: "pdf" });
      return;
    }
    let result;
    try {
      result = await scanner.open(file);
    } catch (e) {
      onError("Image illisible.");
      return;
    }
    if (result) await setFace(side, { ...result, ext: "jpg" });
  }

  /* ------------------------------------------------------- mode scanner -- */
  const scanner = (() => {
    let img = null; // ImageData de travail
    let corners = null;
    let mode = "couleur";
    let resolveFn = null;
    let layout = null; // { k, ox, oy } image -> écran

    const el = () => document.getElementById("doc-scanner");

    function draw() {
      const root = el();
      const canvas = root.querySelector(".ds-canvas");
      const stage = root.querySelector(".ds-stage");
      const W = stage.clientWidth || window.innerWidth;
      const H = stage.clientHeight || window.innerHeight - 140;
      const k = Math.min(W / img.width, H / img.height);
      const dw = Math.round(img.width * k), dh = Math.round(img.height * k);
      layout = { k, ox: Math.round((W - dw) / 2), oy: Math.round((H - dh) / 2) };
      canvas.style.left = `${layout.ox}px`;
      canvas.style.top = `${layout.oy}px`;
      canvas.style.width = `${dw}px`;
      canvas.style.height = `${dh}px`;
      drawQuad();
    }

    function toScreen(p) { return { x: layout.ox + p.x * layout.k, y: layout.oy + p.y * layout.k }; }

    function drawQuad() {
      const root = el();
      const pts = corners.map(toScreen);
      root.querySelector(".ds-quad").setAttribute("points", pts.map((p) => `${p.x},${p.y}`).join(" "));
      root.querySelectorAll(".ds-handle").forEach((h, i) => {
        h.style.left = `${pts[i].x}px`;
        h.style.top = `${pts[i].y}px`;
      });
    }

    function setMode(m) {
      mode = m;
      el().querySelectorAll("[data-ds-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dsMode === m)));
    }

    async function open(file) {
      const root = el();
      img = await fileToImageData(file);
      corners = detectCorners(img) || defaultCorners(img.width, img.height);
      const canvas = root.querySelector(".ds-canvas");
      const preview = toCanvas(img);
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(preview, 0, 0);
      setMode(mode);
      root.querySelector(".ds-busy").hidden = true;
      root.hidden = false;
      document.body.classList.add("doc-overlay-open");
      requestAnimationFrame(draw);
      return new Promise((resolve) => { resolveFn = resolve; });
    }

    function close(result) {
      const root = el();
      root.hidden = true;
      document.body.classList.remove("doc-overlay-open");
      const r = resolveFn;
      resolveFn = null;
      img = null;
      if (r) r(result);
    }

    async function validate() {
      const root = el();
      root.querySelector(".ds-busy").hidden = false;
      await new Promise((r) => setTimeout(r, 30)); // laisse s'afficher « Traitement… »
      try {
        const out = warpPerspective(img, corners, outputSize(corners));
        enhance(out, mode);
        const c = toCanvas(out);
        const blob = await toJpegBlob(c, 0.85);
        const k = Math.min(1, THUMB_SIDE / Math.max(c.width, c.height));
        const t = document.createElement("canvas");
        t.width = Math.max(1, Math.round(c.width * k));
        t.height = Math.max(1, Math.round(c.height * k));
        t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
        const thumb = await toJpegBlob(t, 0.75);
        close({ blob, thumb, width: out.width, height: out.height });
      } catch (e) {
        root.querySelector(".ds-busy").hidden = true;
        onError("Recadrage impossible : ajustez les coins.");
      }
    }

    function wire() {
      const root = el();
      if (!root) return;
      root.querySelector(".ds-cancel").addEventListener("click", () => close(null));
      root.querySelector(".ds-ok").addEventListener("click", validate);
      root.querySelector(".ds-full").addEventListener("click", () => { corners = fullCorners(img.width, img.height); drawQuad(); });
      root.querySelector(".ds-auto").addEventListener("click", () => {
        corners = detectCorners(img) || defaultCorners(img.width, img.height);
        drawQuad();
      });
      root.querySelectorAll("[data-ds-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.dsMode)));
      root.querySelectorAll(".ds-handle").forEach((h, i) => {
        h.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          h.setPointerCapture(e.pointerId);
          const stage = root.querySelector(".ds-stage").getBoundingClientRect();
          const move = (ev) => {
            const x = (ev.clientX - stage.left - layout.ox) / layout.k;
            const y = (ev.clientY - stage.top - layout.oy) / layout.k;
            corners[i] = { x: Math.max(0, Math.min(img.width, x)), y: Math.max(0, Math.min(img.height, y)) };
            drawQuad();
          };
          const up = () => {
            h.removeEventListener("pointermove", move);
            h.removeEventListener("pointerup", up);
            h.removeEventListener("pointercancel", up);
          };
          h.addEventListener("pointermove", move);
          h.addEventListener("pointerup", up);
          h.addEventListener("pointercancel", up);
        });
      });
      window.addEventListener("resize", () => { if (!root.hidden && img) draw(); });
    }

    return { open, wire, _state: () => ({ corners, mode, width: img && img.width, height: img && img.height }) };
  })();

  /* ------------------------------------------------------ visionneuse -- */
  const viewer = { el: null, doc: null, side: "recto", files: null, urls: {}, canDelete: false, onDelete: null };
  const zoom = { s: 1, x: 0, y: 0 };

  function applyZoom() {
    const z = viewer.el && viewer.el.querySelector(".dv-zoom");
    if (!z) return;
    z.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
    z.dataset.scale = zoom.s.toFixed(2);
  }
  function resetZoom() { zoom.s = 1; zoom.x = 0; zoom.y = 0; applyZoom(); }
  function setZoom(s, cx, cy) {
    // Zoom autour du point (cx, cy) exprimé par rapport au centre de la scène.
    const ns = Math.max(1, Math.min(6, s));
    const r = ns / zoom.s;
    zoom.x = cx - (cx - zoom.x) * r;
    zoom.y = cy - (cy - zoom.y) * r;
    zoom.s = ns;
    if (ns === 1) { zoom.x = 0; zoom.y = 0; }
    applyZoom();
  }

  async function openViewer(doc, { files = null, canDelete = false, onDelete = null, side = "recto" } = {}) {
    const el = document.getElementById("doc-viewer");
    if (!el) return;
    viewer.el = el;
    viewer.doc = doc;
    viewer.files = files || {};
    viewer.urls = {};
    viewer.canDelete = canDelete;
    viewer.onDelete = onDelete;
    el.querySelector(".dv-title").textContent = docTitle(doc);
    el.querySelector(".dv-delete").hidden = !canDelete;
    const sides = el.querySelector(".dv-sides");
    sides.hidden = !doc.verso_path;
    el.hidden = false;
    document.body.classList.add("doc-overlay-open");
    await showSide(side);
  }

  async function urlForViewer(path) {
    if (!path) return null;
    if (viewer.files[path]) {
      const blob = viewer.files[path];
      return { url: isPdfPath(path) ? null : await blobToDataUrl(blob), blob };
    }
    try {
      const got = await api.signedUrls([path]);
      if (got && got[path]) return { url: got[path], blob: null };
    } catch (e) { /* hors ligne et non en cache */ }
    return null;
  }

  async function showSide(side) {
    const el = viewer.el;
    viewer.side = side;
    resetZoom();
    el.querySelectorAll("[data-dv-side]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dvSide === side)));
    const path = viewer.doc[`${side}_path`];
    const zoomEl = el.querySelector(".dv-zoom");
    viewer.isPdf = isPdfPath(path);
    zoomEl.classList.toggle("is-pdf", viewer.isPdf);
    zoomEl.textContent = "";
    zoomEl.dataset.side = side;
    const got = await urlForViewer(path);
    if (viewer.side !== side) return;
    if (!got) {
      zoomEl.innerHTML = '<p class="dv-msg">Document indisponible hors ligne.</p>';
      return;
    }
    if (isPdfPath(path)) {
      const host = document.createElement("div");
      host.className = "dv-pdf";
      zoomEl.appendChild(host);
      let blob = got.blob;
      try {
        if (!blob) blob = await (await fetch(got.url)).blob();
        const { renderPdfInto } = await import("./pdf-viewer.js?v=21");
        await renderPdfInto(blob, host);
      } catch (e) {
        host.innerHTML = '<p class="dv-msg">Aperçu PDF indisponible.</p>';
      }
      return;
    }
    const img = document.createElement("img");
    img.className = "dv-img";
    img.alt = `${docTitle(viewer.doc)} - ${side}`;
    img.draggable = false;
    img.src = got.url;
    zoomEl.appendChild(img);
  }

  function closeViewer() {
    if (viewer.el) viewer.el.hidden = true;
    document.body.classList.remove("doc-overlay-open");
    const z = viewer.el && viewer.el.querySelector(".dv-zoom");
    if (z) z.textContent = "";
  }

  function wireViewer() {
    const el = document.getElementById("doc-viewer");
    if (!el) return;
    el.querySelector(".dv-close").addEventListener("click", closeViewer);
    el.querySelectorAll("[data-dv-side]").forEach((b) => b.addEventListener("click", () => showSide(b.dataset.dvSide)));
    el.querySelector(".dv-delete").addEventListener("click", async () => {
      if (!viewer.onDelete || !window.confirm("Supprimer ce document ?")) return;
      const ok = await viewer.onDelete(viewer.doc);
      if (ok !== false) closeViewer();
    });
    document.addEventListener("keydown", (e) => { if (!el.hidden && e.key === "Escape") closeViewer(); });
    // Zoom pincé (pointer events), déplacement à un doigt une fois zoomé, double
    // tape = 2,5x / retour, Ctrl+molette (pincement trackpad) sur ordinateur.
    const stage = el.querySelector(".dv-stage");
    const pts = new Map();
    let pinch = null;
    let pan = null;
    let lastTap = 0;
    const center = (e) => {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
    };
    stage.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, center(e));
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }
      if (pts.size === 2) {
        const [a, b] = Array.from(pts.values());
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: zoom.s, x: zoom.x, y: zoom.y,
          m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        pan = null;
      } else if (pts.size === 1) {
        const now = Date.now();
        const c = center(e);
        if (now - lastTap < 300) { setZoom(zoom.s > 1 ? 1 : 2.5, c.x, c.y); lastTap = 0; } else lastTap = now;
        // PDF (pages empilées) : déplacement vertical possible même sans zoom.
        pan = zoom.s > 1 || viewer.isPdf ? { p: c, x: zoom.x, y: zoom.y } : null;
      }
    });
    stage.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, center(e));
      if (pinch && pts.size >= 2) {
        const [a, b] = Array.from(pts.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoom.s = pinch.s; zoom.x = pinch.x; zoom.y = pinch.y;
        setZoom(pinch.s * (d / pinch.d), pinch.m.x, pinch.m.y);
      } else if (pan) {
        const c = pts.get(e.pointerId);
        zoom.x = pan.x + (c.x - pan.p.x);
        zoom.y = pan.y + (c.y - pan.p.y);
        applyZoom();
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) pan = null;
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const c = center(e);
      setZoom(zoom.s * Math.exp(-e.deltaY / 200), c.x, c.y);
    }, { passive: false });
  }

  /* ------------------------------------------------------- écran admin -- */
  async function loadAdmin() {
    const host = document.getElementById("docs-admin-list");
    if (!host) return;
    const title = document.getElementById("docs-admin-title");
    const back = document.getElementById("btn-docs-admin-back");
    host.innerHTML = '<p class="entity-empty">Chargement…</p>';
    if (back) back.hidden = true;
    if (title) title.textContent = "Documents des chauffeurs";
    let owners = [];
    try {
      owners = await api.owners();
    } catch (e) {
      host.innerHTML = '<p class="entity-empty">Liste indisponible (réseau).</p>';
      return;
    }
    host.textContent = "";
    if (!owners.length) {
      host.innerHTML = '<p class="entity-empty">Aucun document.</p>';
      return;
    }
    for (const o of owners) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sheet-item doc-owner";
      b.dataset.ownerId = o.owner_id;
      const st = expiryStatus(o.prochaine_expiration);
      const dot = st === "expired" || st === "soon" ? `<span class="doc-dot is-${st}" aria-hidden="true"></span>` : "";
      b.innerHTML = `<strong></strong><span>${dot}${o.nb} document${o.nb > 1 ? "s" : ""}</span>`;
      b.querySelector("strong").textContent = o.nom || o.email;
      b.addEventListener("click", () => loadAdminOwner(o));
      host.appendChild(b);
    }
  }

  async function loadAdminOwner(o) {
    const host = document.getElementById("docs-admin-list");
    const title = document.getElementById("docs-admin-title");
    const back = document.getElementById("btn-docs-admin-back");
    if (title) title.textContent = o.nom || o.email;
    if (back) back.hidden = false;
    host.innerHTML = '<p class="entity-empty">Chargement…</p>';
    let rows = [];
    let urls = {};
    try {
      rows = sortDocs(await api.list(o.owner_id));
      const thumbs = rows.map((r) => (isPdfPath(r.recto_path) ? null : thumbOf(r.recto_path))).filter(Boolean);
      urls = await api.signedUrls(thumbs);
    } catch (e) {
      host.innerHTML = '<p class="entity-empty">Documents indisponibles (réseau).</p>';
      return;
    }
    host.textContent = "";
    if (!rows.length) host.innerHTML = '<p class="entity-empty">Aucun document.</p>';
    for (const r of rows) {
      host.appendChild(cardNode(r, {
        urlFor: (p) => urls[p] || null, editable: false,
        onShow: (d) => openViewer(d, {
          canDelete: true,
          onDelete: async (doc) => {
            try {
              await api.send({ kind: "delete", docId: doc.id });
            } catch (e) {
              onError("Suppression impossible pour le moment.");
              return false;
            }
            loadAdminOwner(o);
            return true;
          },
        }),
      }));
    }
  }

  /* ------------------------------------------------------- câblage DOM -- */
  function init() {
    const add = document.getElementById("btn-doc-add");
    if (add) add.addEventListener("click", () => openSheet(null));
    const el = document.getElementById("doc-sheet");
    if (el) {
      el.querySelector(".doc-sheet-close").addEventListener("click", closeSheet);
      el.addEventListener("click", (e) => { if (e.target === el) closeSheet(); });
      el.querySelectorAll('input[name="doc-type"]').forEach((r) => r.addEventListener("change", () => onFieldChange(true)));
      el.querySelector("#doc-expiration").addEventListener("change", () => onFieldChange(true));
      for (const id of ["#doc-libelle", "#doc-numero"]) {
        const f = el.querySelector(id);
        f.addEventListener("input", () => onFieldChange(false));
        f.addEventListener("change", () => onFieldChange(true));
      }
      el.querySelectorAll(".doc-face").forEach((slot) => {
        const side = slot.dataset.side;
        slot.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => pick(side, b.dataset.pick)));
        const prev = slot.querySelector(".doc-face-preview");
        prev.addEventListener("click", () => {
          const d = sheet.draft;
          if (d && d[`${side}_path`]) openViewer({ ...d }, { files: d.files, side });
        });
        const rm = slot.querySelector(".doc-face-remove");
        if (rm) rm.addEventListener("click", removeVerso);
      });
      el.querySelector("#btn-doc-delete").addEventListener("click", deleteDoc);
    }
    for (const kind of ["camera", "gallery", "pdf"]) {
      const input = document.getElementById(`doc-input-${kind}`);
      if (input) input.addEventListener("change", () => onFileChosen(input.files && input.files[0], kind));
    }
    const back = document.getElementById("btn-docs-admin-back");
    if (back) back.addEventListener("click", loadAdmin);
    scanner.wire();
    wireViewer();
    const kick = () => queue.flush().catch(() => {});
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick(); });
    setInterval(async () => {
      try {
        if ((await queue.list()).length && navigator.onLine !== false) kick();
      } catch (e) { /* ignore */ }
    }, 30000);
    kick();
  }

  /** Déconnexion : dernier envoi (borné) puis purge du cache et de la file. */
  async function purgeLocal() {
    closeViewer();
    const off = document.getElementById("docs-offline");
    if (off) off.hidden = true;
    if (sheet.el) sheet.el.hidden = true;
    docs = [];
    await purgeStores({ cache, queueStore, flush: navigator.onLine === false ? null : () => queue.flush() });
  }

  /* ---------------------------- accès sans session (écran de connexion) -- */
  // Session expirée + pas de réseau (jeton non renouvelable) : l'écran de
  // connexion propose de montrer les documents DÉJÀ en cache sur cet appareil
  // (ceux du dernier utilisateur, qui ne s'est pas déconnecté ; la déconnexion
  // purge tout). Lecture seule, uniquement hors ligne.
  async function offlineAccess() {
    const btn = document.getElementById("btn-docs-offline");
    if (!btn) return;
    let n = 0;
    try { n = (await cache.getAll()).length; } catch (e) { n = 0; }
    const login = document.getElementById("screen-login");
    btn.hidden = !(n > 0 && navigator.onLine === false && login && !login.hidden);
  }

  async function openOffline() {
    const el = document.getElementById("docs-offline");
    const host = document.getElementById("docs-offline-list");
    if (!el || !host) return;
    let cached = [];
    try { cached = await cache.getAll(); } catch (e) { cached = []; }
    const list = mergeDocs(cached, [], null);
    host.textContent = "";
    for (const doc of list) {
      host.appendChild(cardNode(doc, {
        urlFor: localUrlFor(doc), editable: false,
        onShow: (d) => openViewer(d, { files: d.files }),
      }));
    }
    el.hidden = false;
  }

  function initOfflineAccess() {
    const btn = document.getElementById("btn-docs-offline");
    if (btn) btn.addEventListener("click", openOffline);
    const close = document.getElementById("btn-docs-offline-close");
    if (close) close.addEventListener("click", () => { document.getElementById("docs-offline").hidden = true; });
    window.addEventListener("online", offlineAccess);
    window.addEventListener("offline", offlineAccess);
  }

  /** Pré-chargement silencieux du cache (au démarrage, pour un contrôle sans réseau). */
  async function warmCache() {
    try {
      const rows = await api.list(null);
      await syncCache({ cache, rows, owner: owner(), fetchFiles });
    } catch (e) { /* hors ligne */ }
  }

  return {
    init, load, loadAdmin, purgeLocal, warmCache, openSheet, offlineAccess, initOfflineAccess,
    _scanner: scanner, _wantedFiles: wantedFiles, _typeLabel: typeLabel, _types: DOC_TYPES,
  };
}
