/* app.js — coquille applicative bon.kerlam.fr (module ES).
 *
 * Honnêteté du périmètre : les vues "Aujourd'hui" (saisie du jour) et "Contrôle"
 * (lecture hors-ligne) sont câblées de bout en bout sur le vrai contrat Supabase
 * (cf. supabase/migrations/0001..0007). "Mes LV" est fonctionnelle (liste réelle,
 * ouverture dans l'éditeur du jour). Le reste des écrans du menu bureau (Planning,
 * Projets, Clients, Sites, Camions, Chauffeurs, Articles, Utilisateurs) est un
 * stub « À venir » — pas de CRUD construit pour cette livraison.
 *
 * Limitations connues (volontaires, documentées dans README.md) :
 * - Le choix d'appli de navigation (Google Maps / Waze / Plans) est une
 *   préférence LOCALE (localStorage) : la RLS réserve l'écriture de
 *   bon.chauffeurs au rôle bureau, un chauffeur ne peut donc pas persister
 *   lui-même cette préférence côté serveur depuis ce shell.
 * - L'undo "serveur" (création/suppression de tour ou de ligne) s'appuie sur
 *   api.lv_undo, qui défait le dernier changement tracé en audit côté Postgres ;
 *   son "redo" recharge simplement l'état courant (pas de vrai rejouable
 *   côté serveur). L'undo "champ" (saisie de texte/select) est lui pleinement
 *   réversible côté client.
 * - Ctrl+Z / Ctrl+Maj+Z sont interceptés globalement pour piloter la pile
 *   d'undo applicative : l'undo natif du navigateur dans un champ texte est
 *   donc volontairement désactivé au profit de cette pile.
 */

import {
  sb,
  getSession,
  onAuthStateChange,
  signInWithGoogle,
  signOut,
  getProfil,
  getChauffeurByEmail,
  getLvDuJour,
  getLv,
  createLv,
  updateLv,
  getTours,
  createTour,
  updateTour,
  deleteTour,
  getLignes,
  createLigne,
  updateLigne,
  deleteLigne,
  listArticles,
  listCamions,
  listClients,
  listProjets,
  listContacts,
  listSites,
  rpcLvPoids,
  rpcPrefill,
  rpcSitesPour,
  rpcLvUndo,
  rpcSetDerniereUnite,
  todayIso,
} from "./supabase-client.js";

/* ============================================================== IndexedDB == */
/* Deux object stores :
 *  - "cache" (clé/valeur) : dernier instantané connu (LV du jour) pour l'écran
 *    Contrôle, qui doit pouvoir s'afficher hors-ligne.
 *  - "queue" (autoIncrement) : écritures en attente quand le réseau a coupé en
 *    plein milieu d'une saisie (cf. window.bonSync plus bas).
 */
const DB_NAME = "bon-kerlam";
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(store, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAdd(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).add(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ================================================= File de synchro sortante == */
/* window.bonSync.queueLength est lu par assets/app-version.js : on ne recharge
 * jamais le shell tant que cette file n'est pas vide. */
window.bonSync = window.bonSync || { queueLength: 0 };

async function refreshQueueLength() {
  const items = await idbAll("queue").catch(() => []);
  window.bonSync.queueLength = items.length;
  window.dispatchEvent(new CustomEvent("bonsync:change", { detail: { length: items.length } }));
  return items.length;
}

async function enqueueWrite(op) {
  await idbAdd("queue", { ...op, createdAt: Date.now() });
  await refreshQueueLength();
  scheduleFlush();
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, 1500);
}

async function applyOp(op) {
  switch (op.table) {
    case "lettres_voiture":
      return updateLv(op.id, op.patch);
    case "tours":
      return updateTour(op.id, op.patch);
    case "tour_lignes":
      return updateLigne(op.id, op.patch);
    default:
      throw new Error("Opération de file inconnue : " + op.table);
  }
}

async function flushQueue() {
  if (!navigator.onLine) return;
  const items = await idbAll("queue").catch(() => []);
  for (const item of items) {
    try {
      await applyOp(item);
      await idbDelete("queue", item.id);
    } catch (err) {
      console.warn("[app] flushQueue: échec, nouvelle tentative plus tard", err);
      break; // on garde l'ordre FIFO : on ne saute pas un item en échec
    }
  }
  await refreshQueueLength();
  setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
}

window.addEventListener("online", flushQueue);
setInterval(flushQueue, 30000);

/* ---------------------------------------------------------- Indicateur global */
const syncIndicatorEl = document.getElementById("sync-indicator");
function setSyncState(state) {
  syncIndicatorEl.classList.remove("sync-saved", "sync-sending", "sync-offline");
  if (state === "sending") {
    syncIndicatorEl.classList.add("sync-sending");
    syncIndicatorEl.textContent = "Envoi en cours";
  } else if (state === "offline") {
    syncIndicatorEl.classList.add("sync-offline");
    syncIndicatorEl.textContent = "Hors ligne, sera envoyé";
  } else {
    syncIndicatorEl.classList.add("sync-saved");
    syncIndicatorEl.textContent = "Enregistré";
  }
}

async function patchRemote(table, id, patch) {
  try {
    switch (table) {
      case "lettres_voiture":
        await updateLv(id, patch);
        break;
      case "tours":
        await updateTour(id, patch);
        break;
      case "tour_lignes":
        await updateLigne(id, patch);
        break;
      default:
        throw new Error("Table inconnue: " + table);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueWrite({ table, id, patch });
      return; // mis en file : pas une erreur pour l'appelant, juste "hors ligne"
    }
    reportIfVersionMismatch(err);
    throw err;
  }
}

function isNetworkError(err) {
  return err instanceof TypeError || (err && /network|fetch|failed to fetch/i.test(err.message || ""));
}

function reportIfVersionMismatch(err) {
  const msg = ((err && (err.message || err.details)) || "") + "";
  if (/schema cache|PGRST20[0-9]|406 not acceptable/i.test(msg)) {
    window.dispatchEvent(new CustomEvent("bon:api-version-mismatch"));
  }
}

/* -------------------------------------------------------------- Champ autosave */
const debounceTimers = new WeakMap();
function autosaveField(el, { debounceMs = 600, save } = {}) {
  const handler = () => {
    setSyncState("sending");
    clearTimeout(debounceTimers.get(el));
    const t = setTimeout(async () => {
      try {
        await save(el.value);
        setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
      } catch (err) {
        console.error("[app] autosave en échec", err);
        setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
      }
    }, debounceMs);
    debounceTimers.set(el, t);
  };
  el.addEventListener("input", handler);
  el.addEventListener("change", handler);
}

function wireAutosaveField(el, { table, id, ensureId, field, transform }) {
  let baseline = null;
  el.addEventListener("focus", () => {
    baseline = el.value;
  });
  autosaveField(el, {
    save: async (value) => {
      const recId = ensureId ? await ensureId() : id;
      if (!recId) return;
      const v = transform ? transform(value) : value === "" ? null : value;
      await patchRemote(table, recId, { [field]: v });
    },
  });
  el.addEventListener("blur", () => {
    if (baseline !== null && baseline !== el.value) {
      const prev = baseline;
      const next = el.value;
      pushUndo({
        kind: "field",
        undo: async () => {
          el.value = prev;
          el.dispatchEvent(new Event("input"));
        },
        redo: async () => {
          el.value = next;
          el.dispatchEvent(new Event("input"));
        },
      });
    }
    baseline = null;
  });
}

function toIntOrNull(v) {
  return v === "" || v == null ? null : parseInt(v, 10);
}
function toFloatOrNull(v) {
  return v === "" || v == null ? null : parseFloat(v);
}
function timeToIso(timeStr) {
  if (!timeStr) return null;
  const dateStr = (state.lv && state.lv.date_etablissement) || todayIso();
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------------------------------------------ Undo/redo */
const undoStack = [];
const redoStack = [];
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");

function pushUndo(entry) {
  undoStack.push(entry);
  redoStack.length = 0;
  refreshUndoButtons();
}
function refreshUndoButtons() {
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}
async function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  await entry.undo();
  redoStack.push(entry);
  refreshUndoButtons();
}
async function redo() {
  const entry = redoStack.pop();
  if (!entry) return;
  await entry.redo();
  undoStack.push(entry);
  refreshUndoButtons();
}
function pushServerUndo() {
  const lvId = state.lv && state.lv.id;
  if (!lvId) return;
  pushUndo({
    kind: "server",
    undo: async () => {
      await rpcLvUndo(lvId);
      await loadToursFor(state.lv);
    },
    redo: async () => {
      await loadToursFor(state.lv);
    },
  });
}

/* --------------------------------------------------------------------- Thème */
const THEME_KEY = "bon_theme";
function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "auto";
  } catch (e) {
    return "auto";
  }
}
function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.checked = r.value === theme;
  });
}
function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {}
  applyTheme(theme);
}

/* --------------------------------------------------------- Appli de navigation */
/* Préférence locale uniquement : cf. note de limitation en tête de fichier. */
const NAV_APP_KEY = "bon_nav_app";
function getNavApp() {
  try {
    const stored = localStorage.getItem(NAV_APP_KEY);
    if (stored) return stored;
  } catch (e) {}
  return (state.chauffeur && state.chauffeur.nav_app) || "google_maps";
}
function setNavApp(v) {
  try {
    localStorage.setItem(NAV_APP_KEY, v);
  } catch (e) {}
}
function buildNavUrl(lat, lon) {
  const navApp = getNavApp();
  if (navApp === "waze") return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
  if (navApp === "apple_plans") return `https://maps.apple.com/?daddr=${lat},${lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
function updateNavLink(anchor, site) {
  if (site && site.lat != null && site.lon != null) {
    anchor.href = buildNavUrl(site.lat, site.lon);
    anchor.hidden = false;
  } else {
    anchor.hidden = true;
  }
}

/* -------------------------------------------------------------------- État == */
const state = {
  session: null,
  profil: null,
  chauffeur: null,
  refs: { camions: [], clients: [], projets: [], contacts: [], articles: [], sites: [] },
  lv: null,
  tours: [],
  lastPoids: null,
  prefillData: {},
  route: "dashboard",
};

const ROUTES = [
  "dashboard", "today", "mes-lv", "controle", "reglages",
  "lv", "planning", "projets", "clients", "sites", "camions",
  "chauffeurs", "articles", "utilisateurs",
];

/* -------------------------------------------------------------------- Utils == */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function populateSelect(selectEl, items, getValue, getLabel, placeholder = "—") {
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = String(getValue(item));
    opt.textContent = getLabel(item);
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
}

function findSiteById(id) {
  if (id == null || id === "") return null;
  return state.refs.sites.find((s) => String(s.id) === String(id)) || null;
}

async function getSiteOptionsList() {
  const clientId = document.getElementById("f-client").value;
  if (state.chauffeur && clientId) {
    try {
      const ranked = await rpcSitesPour(state.chauffeur.id, parseInt(clientId, 10));
      if (ranked && ranked.length) return ranked;
    } catch (e) {
      /* on retombe sur la liste plate */
    }
  }
  return state.refs.sites;
}

/* ============================================================ Référentiels == */
async function loadRefs() {
  const [camions, clients, projets, contacts, articles, sites] = await Promise.all([
    listCamions().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listClients().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listProjets().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listContacts().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listArticles().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listSites().catch((e) => { reportIfVersionMismatch(e); return []; }),
  ]);
  state.refs = { camions, clients, projets, contacts, articles, sites };
  populateSelect(document.getElementById("f-camion"), camions, (c) => c.id, (c) => c.immatriculation);
  populateSelect(document.getElementById("f-client"), clients, (c) => c.id, (c) => c.raison_sociale);
  refreshProjetContactOptions();
}

function refreshProjetContactOptions() {
  const clientId = document.getElementById("f-client").value;
  const projets = clientId ? state.refs.projets.filter((p) => String(p.client_id) === clientId) : state.refs.projets;
  const contacts = clientId ? state.refs.contacts.filter((c) => String(c.client_id) === clientId) : state.refs.contacts;
  populateSelect(document.getElementById("f-projet"), projets, (p) => p.id, (p) => p.nom || p.ref_contrat || `Projet #${p.id}`);
  populateSelect(document.getElementById("f-contact"), contacts, (c) => c.id, (c) => c.nom);
}

/* ===================================================== Formulaire d'en-tête == */
function fillHeaderForm(data) {
  const d = data || {};
  document.getElementById("f-date").value = d.date_etablissement || todayIso();
  document.getElementById("f-camion").value = d.camion_id != null ? String(d.camion_id) : "";

  const projet = state.refs.projets.find((p) => p.id === d.projet_id);
  document.getElementById("f-client").value = projet ? String(projet.client_id) : "";
  refreshProjetContactOptions();

  document.getElementById("f-projet").value = d.projet_id != null ? String(d.projet_id) : "";
  document.getElementById("f-contact").value = d.contact_id != null ? String(d.contact_id) : "";
  document.getElementById("f-expediteur").value = d.expediteur || "";

  const destIdentique = d.dest_identique !== false;
  document.getElementById("f-dest-identique").checked = destIdentique;
  document.getElementById("field-destinataire-wrap").hidden = destIdentique;
  document.getElementById("f-destinataire").value = d.destinataire || "";
  document.getElementById("f-heures-regie").value = d.heures_regie || "";
}

function renderLvNumero() {
  document.getElementById("lv-numero").textContent = (state.lv && state.lv.numero) || "—";
}

async function ensureLv() {
  if (state.lv && state.lv.id) return state.lv.id;
  const prefill = state.prefillData || {};
  const fields = {
    date_etablissement: document.getElementById("f-date").value || todayIso(),
    chauffeur_id: state.chauffeur ? state.chauffeur.id : null,
    owner_email: state.profil ? state.profil.email : null,
    camion_id: prefill.camion_id || null,
    projet_id: prefill.projet_id || null,
    contact_id: prefill.contact_id || null,
    statut: "en_cours",
  };
  const lv = await createLv(fields);
  state.lv = lv;
  renderLvNumero();
  return lv.id;
}

function wireHeaderAutosave() {
  wireAutosaveField(document.getElementById("f-date"), { table: "lettres_voiture", ensureId: ensureLv, field: "date_etablissement" });
  wireAutosaveField(document.getElementById("f-camion"), { table: "lettres_voiture", ensureId: ensureLv, field: "camion_id", transform: toIntOrNull });
  wireAutosaveField(document.getElementById("f-projet"), { table: "lettres_voiture", ensureId: ensureLv, field: "projet_id", transform: toIntOrNull });
  wireAutosaveField(document.getElementById("f-contact"), { table: "lettres_voiture", ensureId: ensureLv, field: "contact_id", transform: toIntOrNull });
  wireAutosaveField(document.getElementById("f-expediteur"), { table: "lettres_voiture", ensureId: ensureLv, field: "expediteur" });
  wireAutosaveField(document.getElementById("f-destinataire"), { table: "lettres_voiture", ensureId: ensureLv, field: "destinataire" });
  wireAutosaveField(document.getElementById("f-heures-regie"), { table: "lettres_voiture", ensureId: ensureLv, field: "heures_regie" });

  document.getElementById("f-client").addEventListener("change", refreshProjetContactOptions);

  const destCheckbox = document.getElementById("f-dest-identique");
  destCheckbox.addEventListener("change", async () => {
    document.getElementById("field-destinataire-wrap").hidden = destCheckbox.checked;
    setSyncState("sending");
    try {
      const lvId = await ensureLv();
      await patchRemote("lettres_voiture", lvId, { dest_identique: destCheckbox.checked });
      setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
    } catch (err) {
      console.error(err);
      setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
    }
  });
}

/* ============================================================= Vue "Aujourd'hui" */
async function loadToday() {
  const chauffeurId = state.chauffeur ? state.chauffeur.id : null;
  let lv = null;
  state.prefillData = {};
  if (chauffeurId) {
    try {
      state.prefillData = (await rpcPrefill(chauffeurId)) || {};
    } catch (err) {
      reportIfVersionMismatch(err);
    }
    if (state.prefillData.lv_id) {
      try {
        lv = await getLv(state.prefillData.lv_id);
      } catch (err) {
        /* ignore */
      }
    }
    if (!lv) {
      try {
        lv = await getLvDuJour(chauffeurId);
      } catch (err) {
        /* ignore */
      }
    }
  }
  state.lv = lv;
  fillHeaderForm(lv || state.prefillData);
  renderLvNumero();
  await loadToursFor(lv);
}

async function loadToursFor(lv) {
  const listEl = document.getElementById("tours-list");
  listEl.innerHTML = "";
  state.tours = [];
  if (!lv) {
    await refreshWeightGauge();
    return;
  }
  let tours = [];
  try {
    tours = await getTours(lv.id);
  } catch (err) {
    reportIfVersionMismatch(err);
  }
  for (const tour of tours) {
    let lignes = [];
    try {
      lignes = await getLignes(tour.id);
    } catch (err) {
      /* ignore */
    }
    const entry = { tour, lignes };
    state.tours.push(entry);
    await renderTourCard(entry);
  }
  await refreshWeightGauge();
}

async function renderTourCard(entry) {
  const { tour, lignes } = entry;
  const tpl = document.getElementById("tpl-tour");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.tourId = tour.id;
  node.querySelector(".tour-card-title").textContent = `Tour n°${tour.ordre}`;

  const chargementSel = node.querySelector(".f-site-chargement");
  const dechargementSel = node.querySelector(".f-site-dechargement");
  const navLinks = node.querySelectorAll(".nav-link");
  const chargementNav = navLinks[0];
  const dechargementNav = navLinks[1];

  const siteOptions = await getSiteOptionsList();
  populateSelect(chargementSel, siteOptions, (s) => s.id, (s) => s.nom, "Choisir un site…");
  populateSelect(dechargementSel, siteOptions, (s) => s.id, (s) => s.nom, "Choisir un site…");
  chargementSel.value = tour.site_chargement_id != null ? String(tour.site_chargement_id) : "";
  dechargementSel.value = tour.site_dechargement_id != null ? String(tour.site_dechargement_id) : "";
  updateNavLink(chargementNav, findSiteById(chargementSel.value));
  updateNavLink(dechargementNav, findSiteById(dechargementSel.value));

  chargementSel.addEventListener("change", () => updateNavLink(chargementNav, findSiteById(chargementSel.value)));
  dechargementSel.addEventListener("change", () => updateNavLink(dechargementNav, findSiteById(dechargementSel.value)));

  wireAutosaveField(chargementSel, { table: "tours", id: tour.id, field: "site_chargement_id", transform: toIntOrNull });
  wireAutosaveField(dechargementSel, { table: "tours", id: tour.id, field: "site_dechargement_id", transform: toIntOrNull });

  const heureInput = node.querySelector(".f-heure-depart");
  heureInput.value = tour.heure_depart ? new Date(tour.heure_depart).toISOString().slice(11, 16) : "";
  wireAutosaveField(heureInput, { table: "tours", id: tour.id, field: "heure_depart", transform: timeToIso });

  node.querySelector(".btn-delete-tour").addEventListener("click", () => handleDeleteTour(entry, node));
  node.querySelector(".btn-add-ligne").addEventListener("click", () => handleAddLigne(entry, node));

  const lignesList = node.querySelector(".lignes-list");
  for (const ligne of lignes) renderLigneRow(lignesList, entry, ligne);

  document.getElementById("tours-list").appendChild(node);
  return node;
}

function renderLigneRow(lignesList, entry, ligne) {
  const tpl = document.getElementById("tpl-ligne");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.ligneId = ligne.id;

  const articleSel = node.querySelector(".f-ligne-article");
  populateSelect(articleSel, state.refs.articles, (a) => a.id, (a) => a.nom, "Article…");
  articleSel.value = ligne.article_id != null ? String(ligne.article_id) : "";

  const qteInput = node.querySelector(".f-ligne-quantite");
  qteInput.value = ligne.quantite != null ? ligne.quantite : "";

  const uniteSel = node.querySelector(".f-ligne-unite");
  uniteSel.value = ligne.unite || "t";

  wireAutosaveField(articleSel, { table: "tour_lignes", id: ligne.id, field: "article_id", transform: toIntOrNull });
  wireAutosaveField(qteInput, { table: "tour_lignes", id: ligne.id, field: "quantite", transform: toFloatOrNull });
  wireAutosaveField(uniteSel, { table: "tour_lignes", id: ligne.id, field: "unite" });

  // Le poids dépend de ces 3 champs : petite marge pour laisser l'autosave (600ms) partir.
  [articleSel, qteInput, uniteSel].forEach((el) => {
    el.addEventListener("change", () => setTimeout(refreshWeightGauge, 750));
  });
  uniteSel.addEventListener("change", () => {
    if (state.chauffeur && articleSel.value) {
      rpcSetDerniereUnite(state.chauffeur.id, parseInt(articleSel.value, 10), uniteSel.value).catch(() => {});
    }
  });

  node.querySelector(".btn-delete-ligne").addEventListener("click", () => handleDeleteLigne(entry, ligne, node));

  lignesList.appendChild(node);
}

async function handleAddLigne(entry, cardNode) {
  try {
    const ligne = await createLigne({ tour_id: entry.tour.id, unite: "t" });
    entry.lignes.push(ligne);
    renderLigneRow(cardNode.querySelector(".lignes-list"), entry, ligne);
    pushServerUndo();
    await refreshWeightGauge();
  } catch (err) {
    console.error(err);
    alert("Impossible d'ajouter la ligne pour le moment (hors ligne ?). La création d'une ligne nécessite un aller-retour réseau.");
  }
}

async function handleDeleteLigne(entry, ligne, node) {
  try {
    await deleteLigne(ligne.id);
    entry.lignes = entry.lignes.filter((l) => l.id !== ligne.id);
    node.remove();
    pushServerUndo();
    await refreshWeightGauge();
  } catch (err) {
    console.error(err);
  }
}

async function handleDeleteTour(entry, node) {
  try {
    await deleteTour(entry.tour.id);
    state.tours = state.tours.filter((t) => t.tour.id !== entry.tour.id);
    node.remove();
    pushServerUndo();
    await refreshWeightGauge();
  } catch (err) {
    console.error(err);
  }
}

async function addTour() {
  try {
    const lvId = await ensureLv();
    const ordre = state.tours.length + 1;
    const tour = await createTour({ lv_id: lvId, ordre });
    const entry = { tour, lignes: [] };
    state.tours.push(entry);
    await renderTourCard(entry);
    try {
      state.lv = await getLv(lvId); // le 1er tour attribue le numéro KER-##### via trigger
    } catch (err) {
      /* ignore */
    }
    renderLvNumero();
    pushServerUndo();
    await refreshWeightGauge();
  } catch (err) {
    console.error(err);
    alert("Impossible de créer le tour pour le moment (hors ligne ?). La création nécessite un aller-retour réseau.");
  }
}

/* --------------------------------------------------------------- Jauge de poids */
async function refreshWeightGauge() {
  const fillEl = document.getElementById("weight-gauge-fill");
  const textEl = document.getElementById("weight-gauge-text");
  const noteEl = document.getElementById("weight-gauge-note");
  if (!state.lv) {
    fillEl.style.width = "0%";
    fillEl.classList.remove("is-warn", "is-danger");
    textEl.textContent = "—";
    noteEl.textContent = "";
    return;
  }
  try {
    const poids = await rpcLvPoids(state.lv.id);
    state.lastPoids = poids;
    renderWeightGauge(poids, false);
    await cacheTodaySnapshot();
  } catch (err) {
    reportIfVersionMismatch(err);
    if (state.lastPoids) renderWeightGauge(state.lastPoids, true);
  }
}

function renderWeightGauge(poids, isStale) {
  const fillEl = document.getElementById("weight-gauge-fill");
  const textEl = document.getElementById("weight-gauge-text");
  const noteEl = document.getElementById("weight-gauge-note");
  const ratioPct = poids.ratio != null ? Math.round(poids.ratio * 100) : null;

  fillEl.style.width = Math.min(ratioPct || 0, 100) + "%";
  fillEl.classList.remove("is-warn", "is-danger");
  if (poids.gauge === "warn") fillEl.classList.add("is-warn");
  if (poids.gauge === "danger") fillEl.classList.add("is-danger");

  textEl.textContent = poids.ptac_t
    ? `${poids.masse_totale_t} t / ${poids.ptac_t} t (${ratioPct}%)`
    : `${poids.masse_totale_t} t (PTAC inconnu)`;

  let note = poids.poids_partiel ? `${poids.lignes_non_comptees} ligne(s) non convertie(s) en poids. ` : "";
  if (isStale) note += "Dernière valeur connue (hors ligne).";
  noteEl.textContent = note;
}

/* -------------------------------------------------- Instantané hors-ligne (Contrôle) */
async function cacheTodaySnapshot() {
  if (!state.lv) return;
  const snapshot = {
    savedAt: new Date().toISOString(),
    lv: state.lv,
    tours: state.tours.map(({ tour, lignes }) => ({ tour, lignes })),
    poids: state.lastPoids || null,
    articlesById: Object.fromEntries((state.refs.articles || []).map((a) => [a.id, a.nom])),
    sitesById: Object.fromEntries((state.refs.sites || []).map((s) => [s.id, s.nom])),
  };
  await idbSet("cache", "today-snapshot", snapshot).catch(() => {});
}

/* ===================================================================== Mes LV == */
async function loadMesLv() {
  const listEl = document.getElementById("mes-lv-list");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    if (!sb) throw new Error("Client non initialisé");
    const { data, error } = await sb
      .from("lettres_voiture")
      .select("*")
      .order("date_etablissement", { ascending: false })
      .limit(30);
    if (error) throw error;
    if (!data || !data.length) {
      listEl.innerHTML = '<p class="muted">Aucune lettre de voiture.</p>';
      return;
    }
    listEl.innerHTML = "";
    for (const lv of data) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "lv-row";
      row.innerHTML = `
        <span class="lv-row-main">
          <span class="lv-row-numero">${escapeHtml(lv.numero || "(brouillon)")}</span>
          <span class="lv-row-date">${escapeHtml(lv.date_etablissement || "")}</span>
        </span>
        <span class="badge badge-${escapeHtml(lv.statut)}">${escapeHtml(lv.statut)}</span>
      `;
      row.addEventListener("click", () => openLvInToday(lv));
      listEl.appendChild(row);
    }
  } catch (err) {
    reportIfVersionMismatch(err);
    listEl.innerHTML = `<p class="muted">Impossible de charger (hors ligne ?) : ${escapeHtml(err.message || String(err))}</p>`;
  }
}

async function openLvInToday(lv) {
  state.lv = lv;
  fillHeaderForm(lv);
  renderLvNumero();
  await loadToursFor(lv);
  navigate("today");
}

/* ==================================================================== Contrôle == */
async function loadControle() {
  const statusEl = document.getElementById("controle-status");
  const contentEl = document.getElementById("controle-content");
  const snapshot = await idbGet("cache", "today-snapshot").catch(() => null);
  if (!snapshot) {
    statusEl.textContent = "Aucune donnée en cache pour l'instant — ouvrez d'abord « Aujourd'hui ».";
    contentEl.innerHTML = "";
    return;
  }
  statusEl.textContent = `Dernière mise à jour locale : ${new Date(snapshot.savedAt).toLocaleString("fr-FR")}`;
  contentEl.innerHTML = renderControleHtml(snapshot);
}

function renderControleHtml(s) {
  const lv = s.lv || {};
  const poids = s.poids;
  const toursHtml =
    (s.tours || [])
      .map(
        ({ tour, lignes }) => `
    <h2>Tour n°${escapeHtml(tour.ordre)}</h2>
    <dl>
      <dt>Chargement</dt><dd>${escapeHtml(s.sitesById[tour.site_chargement_id] || "—")}</dd>
      <dt>Déchargement</dt><dd>${escapeHtml(s.sitesById[tour.site_dechargement_id] || "—")}</dd>
      <dt>Départ</dt><dd>${tour.heure_depart ? new Date(tour.heure_depart).toLocaleTimeString("fr-FR") : "—"}</dd>
    </dl>
    <ul>
      ${(lignes || [])
        .map((l) => `<li>${escapeHtml(s.articlesById[l.article_id] || "Article")} — ${l.quantite ?? "?"} ${escapeHtml(l.unite || "")}</li>`)
        .join("")}
    </ul>`
      )
      .join("") || "<p>Aucun tour.</p>";

  return `
    <dl>
      <dt>Numéro</dt><dd>${escapeHtml(lv.numero || "non attribué")}</dd>
      <dt>Date</dt><dd>${escapeHtml(lv.date_etablissement || "—")}</dd>
      <dt>Statut</dt><dd>${escapeHtml(lv.statut || "—")}</dd>
      <dt>Expéditeur</dt><dd>${escapeHtml(lv.expediteur || "—")}</dd>
    </dl>
    ${poids ? `<p><strong>Charge :</strong> ${poids.masse_totale_t} t${poids.ptac_t ? ` / ${poids.ptac_t} t (${Math.round((poids.ratio || 0) * 100)}%)` : ""}</p>` : ""}
    ${toursHtml}
  `;
}

/* ========================================================================= Routage == */
function navigate(route) {
  if (!ROUTES.includes(route)) route = "dashboard";
  state.route = route;
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = el.dataset.view !== route;
  });
  document.querySelectorAll(".side-nav a[data-route]").forEach((a) => {
    a.classList.toggle("is-active", a.dataset.route === route);
  });
  document.querySelectorAll(".bottom-bar-item[data-route]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.route === route);
  });
  try {
    history.replaceState(null, "", "#/" + route);
  } catch (e) {}

  if (route === "today") loadToday();
  if (route === "mes-lv") loadMesLv();
  if (route === "controle") loadControle();
}

/* =================================================================== UI statique == */
function wireStaticUI() {
  wireHeaderAutosave();

  document.getElementById("btn-add-tour").addEventListener("click", addTour);
  document.getElementById("btn-controle-refresh").addEventListener("click", async () => {
    await loadToday();
    await loadControle();
  });

  document.querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.dataset.route);
    });
  });

  btnUndo.addEventListener("click", undo);
  btnRedo.addEventListener("click", redo);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() !== "z") return;
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  });

  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (r.checked) setTheme(r.value);
    });
  });
  applyTheme(getStoredTheme());

  document.getElementById("btn-theme").addEventListener("click", () => {
    const order = ["auto", "clair", "sombre"];
    const next = order[(order.indexOf(getStoredTheme()) + 1) % order.length];
    setTheme(next);
  });

  const navAppSel = document.getElementById("f-nav-app");
  navAppSel.value = getNavApp();
  navAppSel.addEventListener("change", (e) => setNavApp(e.target.value));

  document.getElementById("btn-google-login").addEventListener("click", async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      const el = document.getElementById("auth-error");
      el.hidden = false;
      el.textContent = "Connexion impossible : " + (err && err.message ? err.message : "erreur inconnue");
    }
  });
  document.getElementById("btn-logout-unauthorized").addEventListener("click", () => signOut());
  document.getElementById("btn-logout").addEventListener("click", () => signOut());
}

/* ======================================================================== Auth == */
function showScreen(which) {
  document.getElementById("screen-login").hidden = which !== "login";
  document.getElementById("screen-unauthorized").hidden = which !== "unauthorized";
  document.getElementById("app-shell").hidden = which !== "app";
}

function showFatal(message) {
  const el = document.getElementById("auth-error");
  el.hidden = false;
  el.textContent = message;
  showScreen("login");
}

let lastHandledUserId;
async function handleSessionChange(session) {
  state.session = session;
  const userId = session && session.user && session.user.id;
  if (userId === lastHandledUserId) return; // simple refresh de jeton : rien à refaire
  lastHandledUserId = userId;

  if (!session) {
    showScreen("login");
    return;
  }

  let profil = null;
  try {
    profil = await getProfil();
  } catch (err) {
    console.error(err);
    reportIfVersionMismatch(err);
  }
  state.profil = profil;

  if (!profil) {
    document.getElementById("unauthorized-email").textContent = session.user.email || "";
    showScreen("unauthorized");
    return;
  }

  if (profil.role === "chauffeur") {
    try {
      state.chauffeur = await getChauffeurByEmail(profil.email);
    } catch (err) {
      state.chauffeur = null;
    }
  }

  document.getElementById("profil-badge").textContent = `${profil.nom || profil.email} · ${profil.role}`;
  showScreen("app");

  await loadRefs();
  const navAppSel = document.getElementById("f-nav-app");
  if (navAppSel) navAppSel.value = getNavApp();

  const initialRoute = (window.location.hash || "#/dashboard").replace(/^#\//, "") || "dashboard";
  navigate(initialRoute);
}

async function boot() {
  wireStaticUI();

  if (!sb) {
    showFatal("Configuration Supabase manquante ou invalide (assets/config.js).");
    return;
  }

  onAuthStateChange((_event, session) => {
    handleSessionChange(session);
  });

  let session = null;
  try {
    session = await getSession();
  } catch (err) {
    /* ignore : traité comme non connecté */
  }
  await handleSessionChange(session);
}

boot();
