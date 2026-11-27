/* line-photos.js — photos « Avant » / « Après » par ligne de marchandise (beta.35).
 *
 * UI uniquement : icône appareil photo sur chaque ligne -> choix Avant / Après
 * -> appareil photo (ou galerie) -> filigrane côté client -> file d'envoi
 * (photo-queue.js : IndexedDB, envoi auto au retour du réseau). Vignettes sous la
 * ligne (chargées paresseusement par URL signées courtes, miniature dédiée),
 * visionneuse plein écran (balayage), suppression par l'auteur.
 * Jamais sur le PDF, le mail ni le récap de signature (aucune dépendance ici).
 */

import { watermarkImage, getGps, typeLabel, blobToDataUrl } from "./photo-watermark.js?v=350";
import {
  createPhotoQueue, idbStore, memoryStore, canAdd, countByType, sortPhotos,
  photoPaths, thumbPathOf, MAX_PER_TYPE,
} from "./photo-queue.js?v=350";

const URL_TTL_MS = 9 * 60 * 1000; // URL signées 10 min côté serveur : marge 1 min

function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function svg(paths, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const ICON_PENDING = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';

/**
 * api : { list(lvId), upload(item), remove(id), signedUrls(paths) }
 * getContext() : { lv, email } — lettre ouverte + e-mail de l'utilisateur.
 * onCountChange(tourId) : rafraîchit le compteur du tour (résumé replié).
 */
export function createLinePhotos({ api, getContext, demo = false, onCountChange = () => {}, onError = () => {} }) {
  const photos = new Map(); // id -> photo (ligne SQL + champs locaux)
  const lines = new Map(); // ligneId -> { row, strip, badge, tourId }
  const urlCache = new Map(); // chemin -> { url, at }
  let currentLvId = null;
  let pendingTarget = null; // { ligneId, tourId, type }
  let gpsPromise = null;

  const queue = createPhotoQueue({
    store: typeof indexedDB !== "undefined" ? idbStore(demo ? "bon-photos-demo" : "bon-photos") : memoryStore(),
    upload: api.upload,
    onChange: (ev) => {
      if (ev.sent && photos.has(ev.sent.id)) {
        photos.get(ev.sent.id).pending = false;
        renderLine(ev.sent.ligneId);
      }
    },
    onDrop: (item, err) => {
      photos.delete(item.id);
      renderLine(item.ligneId);
      onError(`Photo non envoyée : ${(err && err.message) || "refusée"}`);
    },
  });

  /* ------------------------------------------------------------ données -- */
  const photosOf = (ligneId) => sortPhotos(Array.from(photos.values()).filter((p) => String(p.ligne_id) === String(ligneId)));

  async function loadLv(lv) {
    for (const p of photos.values()) revokeLocal(p);
    photos.clear();
    currentLvId = lv && lv.id != null ? lv.id : null;
    if (currentLvId == null) return;
    let rows = [];
    try {
      rows = await api.list(currentLvId);
    } catch (e) {
      rows = []; // hors ligne : on affiche au moins les photos en attente
    }
    for (const r of rows) photos.set(r.id, { ...r, pending: false });
    let pending = [];
    try {
      pending = await queue.list();
    } catch (e) {
      pending = [];
    }
    for (const it of pending) {
      if (String(it.lvId) !== String(currentLvId) || photos.has(it.id)) continue;
      photos.set(it.id, await localPhoto(it));
    }
    queue.flush().catch(() => {});
  }

  // Vignette locale en data: URL (petite, ~20 Ko ; s'affiche même hors ligne) ;
  // image pleine résolution en URL objet (visionneuse).
  async function localPhoto(it) {
    let thumbUrl = null;
    try {
      thumbUrl = await blobToDataUrl(it.thumb);
    } catch (e) {
      thumbUrl = URL.createObjectURL(it.thumb);
    }
    return {
      id: it.id, ligne_id: it.ligneId, lv_id: it.lvId, tour_id: it.tourId, type: it.type,
      taken_at: it.takenAt, storage_path: photoPaths(it.lvId, it.ligneId, it.id).path,
      created_by: it.createdBy || (getContext().email || null), pending: true,
      localThumb: thumbUrl, localFull: URL.createObjectURL(it.blob),
    };
  }

  function revokeLocal(p) {
    if (p.localThumb && p.localThumb.startsWith("blob:")) URL.revokeObjectURL(p.localThumb);
    if (p.localFull) URL.revokeObjectURL(p.localFull);
  }

  function countForTour(tourId) {
    let n = 0;
    for (const p of photos.values()) if (String(p.tour_id) === String(tourId)) n += 1;
    return n;
  }

  /* ------------------------------------------------------ URL signées -- */
  async function urlsFor(paths) {
    const now = Date.now();
    const missing = paths.filter((p) => !urlCache.has(p) || now - urlCache.get(p).at > URL_TTL_MS);
    if (missing.length) {
      try {
        const got = await api.signedUrls(missing);
        for (const [p, url] of Object.entries(got || {})) urlCache.set(p, { url, at: now });
      } catch (e) {
        /* hors ligne : vignettes non chargées, réessai à la prochaine apparition */
      }
    }
    const out = {};
    for (const p of paths) if (urlCache.has(p)) out[p] = urlCache.get(p).url;
    return out;
  }

  // Chargement paresseux : une seule requête groupée pour les lignes devenues visibles.
  const visibleQueue = new Set();
  let visibleTimer = null;
  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          visibleQueue.add(e.target.dataset.ligneId);
          io.unobserve(e.target);
        }
      }
      clearTimeout(visibleTimer);
      visibleTimer = setTimeout(loadVisibleThumbs, 60);
    }, { rootMargin: "200px" })
    : null;

  async function loadVisibleThumbs() {
    const ids = Array.from(visibleQueue);
    visibleQueue.clear();
    const imgs = [];
    for (const id of ids) {
      const l = lineEntry(id);
      if (!l) continue;
      l.strip.querySelectorAll("img[data-path]").forEach((img) => { if (!img.src) imgs.push(img); });
    }
    if (!imgs.length) return;
    const urls = await urlsFor(Array.from(new Set(imgs.map((i) => i.dataset.path))));
    for (const img of imgs) if (urls[img.dataset.path]) img.src = urls[img.dataset.path];
  }

  /* ---------------------------------------------------------- rendu -- */
  function mountLine(rowNode, { tour, ligne }) {
    const ligneId = String(ligne.id);
    const btn = rowNode.querySelector(".btn-photo-ligne");
    const strip = rowNode.querySelector(".ligne-photos");
    const badge = rowNode.querySelector(".lp-count");
    if (!btn || !strip) return;
    strip.dataset.ligneId = ligneId;
    lines.set(ligneId, { row: rowNode, strip, badge, tourId: tour.id });
    btn.addEventListener("click", () => openTypeSheet(ligneId, tour.id));
    strip.addEventListener("click", (ev) => {
      const t = ev.target.closest(".lp-thumb");
      if (t) openViewer(ligneId, t.dataset.photoId);
    });
    renderLine(ligneId);
  }

  // Dernière ligne montée pour cet id (un re-rendu des tours la remplace ; la
  // ligne peut ne pas être encore attachée au DOM au moment du montage).
  const lineEntry = (ligneId) => lines.get(String(ligneId)) || null;

  function renderLine(ligneId) {
    const l = lineEntry(ligneId);
    if (!l) return;
    const list = photosOf(ligneId);
    l.strip.textContent = "";
    l.strip.hidden = list.length === 0;
    if (l.badge) {
      l.badge.textContent = list.length ? String(list.length) : "";
      l.badge.hidden = list.length === 0;
    }
    let needsRemote = false;
    for (const type of ["avant", "apres"]) {
      const group = list.filter((p) => p.type === type);
      if (!group.length) continue;
      const g = document.createElement("div");
      g.className = "lp-group";
      g.dataset.type = type;
      const lab = document.createElement("span");
      lab.className = "lp-label";
      lab.textContent = typeLabel(type);
      g.appendChild(lab);
      const thumbs = document.createElement("div");
      thumbs.className = "lp-thumbs";
      for (const p of group) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lp-thumb" + (p.pending ? " is-pending" : "");
        b.dataset.photoId = p.id;
        b.setAttribute("aria-label", `Photo ${typeLabel(type).toLowerCase()}${p.pending ? " (en attente d'envoi)" : ""}`);
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.loading = "lazy";
        if (p.localThumb) {
          img.src = p.localThumb;
        } else {
          const path = thumbPathOf(p.storage_path);
          img.dataset.path = path;
          const c = urlCache.get(path);
          if (c && Date.now() - c.at <= URL_TTL_MS) img.src = c.url;
          else needsRemote = true;
        }
        b.appendChild(img);
        if (p.pending) b.insertAdjacentHTML("beforeend", `<span class="lp-pending" title="En attente d'envoi">${svg(ICON_PENDING)}</span>`);
        thumbs.appendChild(b);
      }
      g.appendChild(thumbs);
      l.strip.appendChild(g);
    }
    if (needsRemote) {
      if (io) io.observe(l.strip);
      else { visibleQueue.add(String(ligneId)); loadVisibleThumbs(); }
    }
    onCountChange(l.tourId);
  }

  /* ------------------------------------------------- prise de photo -- */
  const sheet = () => document.getElementById("photo-type-sheet");

  function openTypeSheet(ligneId, tourId) {
    const s = sheet();
    if (!s) return;
    pendingTarget = { ligneId, tourId, type: null };
    const list = photosOf(ligneId);
    s.querySelectorAll("[data-photo-type]").forEach((b) => {
      const type = b.dataset.photoType;
      const full = !canAdd(list, ligneId, type);
      b.disabled = full;
      const n = b.querySelector(".pt-count");
      if (n) n.textContent = full ? `(${MAX_PER_TYPE}/${MAX_PER_TYPE})` : "";
    });
    s.hidden = false;
    // GPS lancé dès maintenant (en parallèle de l'appareil photo).
    gpsPromise = getGps();
  }

  function closeTypeSheet() {
    const s = sheet();
    if (s) s.hidden = true;
  }

  function onChooseType(type, gallery) {
    if (!pendingTarget) return;
    pendingTarget.type = type;
    closeTypeSheet();
    const input = document.getElementById(gallery ? "photo-input-gallery" : "photo-input-camera");
    input.value = "";
    input.click(); // dans le geste utilisateur (exigence iOS)
  }

  async function onFileChosen(file) {
    const target = pendingTarget;
    pendingTarget = null;
    const { lv, email } = getContext();
    if (!file || !target || !target.type || !lv || lv.id == null) return;
    if (!canAdd(photosOf(target.ligneId), target.ligneId, target.type)) return;
    // GPS lancé à l'ouverture du choix : on ne fait pas attendre la vignette plus
    // de ~2,5 s s'il n'a pas encore répondu (filigrane « GPS indisponible »).
    const gps = await Promise.race([
      gpsPromise || Promise.resolve(null),
      new Promise((r) => setTimeout(() => r(null), 2500)),
    ]);
    const takenAt = new Date();
    let out;
    try {
      out = await watermarkImage(file, { type: target.type, numero: lv.numero || null, takenAt, gps });
    } catch (e) {
      onError("Image illisible.");
      return;
    }
    const item = {
      id: uuid(), lvId: lv.id, tourId: target.tourId, ligneId: Number(target.ligneId), type: target.type,
      takenAt: takenAt.toISOString(), lat: gps ? gps.lat : null, lng: gps ? gps.lng : null,
      accuracy: gps && Number.isFinite(gps.accuracy) ? gps.accuracy : null,
      blob: out.blob, thumb: out.thumb, createdBy: email || null,
    };
    photos.set(item.id, await localPhoto(item));
    renderLine(target.ligneId);
    try {
      await queue.enqueue(item);
    } catch (e) {
      /* stockage local indisponible : l'envoi direct a quand même été tenté */
    }
  }

  /* ------------------------------------------------------ visionneuse -- */
  const viewer = { el: null, list: [], idx: 0, ligneId: null };

  function canDelete(p) {
    const { lv, email } = getContext();
    if (!lv || lv.statut === "signee") return false;
    if (p.pending) return true;
    return !!(email && p.created_by && String(p.created_by).toLowerCase() === String(email).toLowerCase());
  }

  async function openViewer(ligneId, photoId) {
    const el = document.getElementById("photo-viewer");
    if (!el) return;
    viewer.el = el;
    viewer.ligneId = ligneId;
    viewer.list = photosOf(ligneId);
    viewer.idx = Math.max(0, viewer.list.findIndex((p) => p.id === photoId));
    el.hidden = false;
    document.body.classList.add("photo-viewer-open");
    showCurrent();
    const remote = viewer.list.filter((p) => !p.localFull).map((p) => p.storage_path);
    if (remote.length) {
      await urlsFor(remote);
      if (!el.hidden) showCurrent();
    }
  }

  function showCurrent() {
    const el = viewer.el;
    const p = viewer.list[viewer.idx];
    if (!el || !p) return closeViewer();
    const img = el.querySelector(".pv-img");
    const full = p.localFull || (urlCache.get(p.storage_path) || {}).url;
    const thumb = p.localThumb || (urlCache.get(thumbPathOf(p.storage_path)) || {}).url;
    const src = full || thumb || "";
    if (img.getAttribute("src") !== src) img.src = src;
    img.alt = `Photo ${typeLabel(p.type).toLowerCase()}`;
    img.dataset.photoId = p.id;
    el.querySelector(".pv-caption").textContent =
      `${typeLabel(p.type)} · ${viewer.idx + 1}/${viewer.list.length}${p.pending ? " · en attente" : ""}`;
    el.querySelector(".pv-delete").hidden = !canDelete(p);
    el.querySelector(".pv-prev").hidden = viewer.idx === 0;
    el.querySelector(".pv-next").hidden = viewer.idx >= viewer.list.length - 1;
  }

  function step(d) {
    const n = viewer.idx + d;
    if (n < 0 || n >= viewer.list.length) return;
    viewer.idx = n;
    showCurrent();
  }

  function closeViewer() {
    if (viewer.el) viewer.el.hidden = true;
    document.body.classList.remove("photo-viewer-open");
  }

  async function deleteCurrent() {
    const p = viewer.list[viewer.idx];
    if (!p || !canDelete(p)) return;
    if (!window.confirm("Supprimer cette photo ?")) return;
    try {
      if (p.pending) await queue.remove(p.id);
      else await api.remove(p.id);
    } catch (e) {
      onError("Suppression impossible pour le moment.");
      return;
    }
    revokeLocal(p);
    photos.delete(p.id);
    renderLine(p.ligne_id);
    viewer.list = photosOf(viewer.ligneId);
    if (viewer.idx >= viewer.list.length) viewer.idx = viewer.list.length - 1;
    if (viewer.list.length) showCurrent();
    else closeViewer();
  }

  /* ------------------------------------------------------- câblage DOM -- */
  function init() {
    const s = sheet();
    if (s) {
      s.addEventListener("click", (ev) => {
        if (ev.target === s || ev.target.closest(".pt-close")) { pendingTarget = null; closeTypeSheet(); return; }
        const b = ev.target.closest("[data-photo-type]");
        if (b && !b.disabled) onChooseType(b.dataset.photoType, b.hasAttribute("data-gallery"));
      });
    }
    for (const id of ["photo-input-camera", "photo-input-gallery"]) {
      const input = document.getElementById(id);
      if (input) input.addEventListener("change", () => onFileChosen(input.files && input.files[0]));
    }
    const el = document.getElementById("photo-viewer");
    if (el) {
      el.querySelector(".pv-close").addEventListener("click", closeViewer);
      el.querySelector(".pv-prev").addEventListener("click", () => step(-1));
      el.querySelector(".pv-next").addEventListener("click", () => step(1));
      el.querySelector(".pv-delete").addEventListener("click", deleteCurrent);
      let x0 = null;
      let y0 = null;
      el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      el.addEventListener("touchend", (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
      });
      document.addEventListener("keydown", (e) => {
        if (el.hidden) return;
        if (e.key === "Escape") closeViewer();
        else if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
      });
    }
    // Envoi automatique : au retour du réseau, au retour au premier plan, et
    // périodiquement tant qu'il reste des photos en attente.
    const kick = () => queue.flush().catch(() => {});
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick(); });
    setInterval(async () => {
      try {
        if ((await queue.list()).length && navigator.onLine !== false) kick();
      } catch (e) {
        /* ignore */
      }
    }, 30000);
    kick();
  }

  return { init, loadLv, mountLine, countForTour, flush: () => queue.flush(), _countByType: countByType };
}
