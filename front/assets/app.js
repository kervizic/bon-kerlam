/* app.js — coquille applicative bon.kerlam.fr (module ES).
 *
 * Depuis la 0.1.0-beta.3, tous les écrans du menu bureau (Tableau de bord,
 * Planning, Projets, Clients + Contacts, Sites, Camions, Chauffeurs + documents
 * réglementaires, Articles, Utilisateurs, Réglages) sont du vrai CRUD autosave
 * sur le schéma `api` (via assets/data.js), au même niveau que "Aujourd'hui" /
 * "Mes LV" / "Contrôle". L'accès aux données passe TOUJOURS par `./data.js`
 * (jamais directement par supabase-client.js) : c'est cette façade qui bascule
 * silencieusement vers le jeu de données fictif du mode démo (`?demo=1`, cf.
 * assets/demo-data.js) sans qu'aucun code ici n'ait besoin de le savoir.
 *
 * Limitations connues (volontaires, documentées dans README.md) :
 * - Le choix d'appli de navigation (Google Maps / Waze / Plans) est une
 *   préférence LOCALE (localStorage) : la RLS réserve l'écriture de
 *   bon.chauffeurs au rôle bureau, un chauffeur ne peut donc pas persister
 *   lui-même cette préférence côté serveur depuis ce shell.
 * - L'undo "serveur" (création/suppression de tour ou de ligne) s'appuie sur
 *   api.lv_undo, qui défait le dernier changement tracé en audit côté Postgres ;
 *   son "redo" recharge simplement l'état courant (pas de vrai rejouable
 *   côté serveur). L'undo "champ" (saisie de texte/select), lui, est pleinement
 *   réversible côté client (undo ET redo), y compris sur tous les nouveaux
 *   écrans bureau qui réutilisent wireAutosaveField.
 * - Ctrl+Z / Ctrl+Maj+Z sont interceptés globalement pour piloter la pile
 *   d'undo applicative : l'undo natif du navigateur dans un champ texte est
 *   donc volontairement désactivé au profit de cette pile.
 * - La fusion d'articles (bouton "Fusionner avec…") n'a pas d'équivalent RPC
 *   côté SQL (cf. supabase/migrations) : stub bureau qui l'indique clairement
 *   plutôt que de faire semblant.
 * - Les endpoints bon-worker (/worker/signature/envoi-groupe,
 *   /worker/chauffeur/{id}/depart) exigent un jeton IA dédié (X-AI-Token, cf.
 *   worker/app/auth.py) non disponible depuis ce shell navigateur ; l'appel est
 *   tenté avec le jeton de session Supabase et échoue proprement (message clair)
 *   si le serveur le refuse — c'est un point d'intégration hors périmètre front.
 */

import {
  sb,
  isDemoMode,
  demoScreenParam,
  demoThemeParam,
  getSession,
  onAuthStateChange,
  signInWithGoogle,
  sendEmailOtp,
  verifyEmailOtp,
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
  listArticlesAll,
  listCamions,
  listClients,
  listProjets,
  listContacts,
  listSites,
  listChauffeurs,
  listUtilisateurs,
  listReglages,
  listLettresVoiture,
  listPlanningLv,
  createProjet,
  updateProjet,
  createClient,
  updateClient,
  createContact,
  updateContact,
  deleteContact,
  createSite,
  updateSite,
  createCamion,
  updateCamion,
  createChauffeur,
  updateChauffeur,
  createArticle,
  updateArticle,
  rpcFusionnerArticle,
  createUtilisateur,
  updateUtilisateur,
  upsertReglage,
  getPermis,
  upsertPermis,
  listPermisCategories,
  createPermisCategorie,
  updatePermisCategorie,
  deletePermisCategorie,
  getFco,
  upsertFco,
  getCarteConducteur,
  upsertCarteConducteur,
  listCaces,
  createCaces,
  updateCaces,
  deleteCaces,
  rpcAlertesDocuments,
  uploadChauffeurDoc,
  signedUrlChauffeurDoc,
  workerEnvoiGroupe,
  workerChauffeurDepart,
  searchAddress,
  reverseAddress,
  rpcLvPoids,
  rpcPrefill,
  rpcSitesPour,
  rpcLvUndo,
  rpcSetDerniereUnite,
  todayIso,
} from "./data.js";

import { initInstall } from "./install.js?v=7";
import { UndoStack } from "./undo-stack.js?v=7";

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

const REMOTE_UPDATERS = {
  lettres_voiture: updateLv,
  tours: updateTour,
  tour_lignes: updateLigne,
  projets: updateProjet,
  clients: updateClient,
  contacts: updateContact,
  sites: updateSite,
  camions: updateCamion,
  chauffeurs: updateChauffeur,
  articles: updateArticle,
  utilisateurs: updateUtilisateur,
  permis: (id, patch) => upsertPermis(id, patch), // id ici = chauffeur_id (cf. wireDocAutosave)
  fco: (id, patch) => upsertFco(id, patch),
  carte_conducteur: (id, patch) => upsertCarteConducteur(id, patch),
  permis_categories: updatePermisCategorie,
  caces: updateCaces,
};

async function applyOp(op) {
  const fn = REMOTE_UPDATERS[op.table];
  if (!fn) throw new Error("Opération de file inconnue : " + op.table);
  return fn(op.id, op.patch);
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
  let pending = 0;
  try { pending = (window.bonSync && window.bonSync.queueLength) || 0; } catch (e) { /* noop */ }
  const label =
    state === "sending" ? "Envoi en cours" :
    state === "offline" ? `Hors ligne – ${pending} en attente` : "Enregistré";
  syncIndicatorEl.classList.add("sync-" + (state === "sending" ? "sending" : state === "offline" ? "offline" : "saved"));
  const txt = syncIndicatorEl.querySelector(".sync-text");
  if (txt) txt.textContent = label; else syncIndicatorEl.textContent = label;
  syncIndicatorEl.setAttribute("aria-label", label);
}

async function patchRemote(table, id, patch) {
  try {
    const fn = REMOTE_UPDATERS[table];
    if (!fn) throw new Error("Table inconnue: " + table);
    await fn(id, patch);
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

/* --------------------------------------------------------------------- Undo */
/* Annulation uniquement (pas de « refaire »). Le bouton « Annuler » n'apparaît
 * QUE dans un formulaire et SEULEMENT après une modification (masqué si la pile
 * est vide). La pile est remise à zéro quand on quitte le formulaire
 * (changement d'écran/onglet, cf. navigate()). Raccourci : Ctrl/Cmd+Z. */
const btnUndo = document.getElementById("btn-undo");
function refreshUndoButtons() {
  if (btnUndo) btnUndo.hidden = undoStack.isEmpty;
}
const undoStack = new UndoStack(refreshUndoButtons);

function pushUndo(entry) {
  undoStack.push(entry.undo);
}
function resetUndo() {
  undoStack.reset();
}
async function undo() {
  await undoStack.undo();
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
  roles: [],
  chauffeur: null,
  refs: { camions: [], clients: [], projets: [], contacts: [], articles: [], sites: [], chauffeurs: [] },
  lv: null,
  tours: [],
  lastPoids: null,
  prefillData: {},
  route: "dashboard",
  reglages: {},
  planningSelection: new Set(),
  sitePickerTarget: null, // <select> actuellement ciblé par la feuille de choix de site
};

const ROUTES = [
  "dashboard", "today", "mes-lv", "controle", "reglages",
  "lv", "planning", "projets", "clients", "sites", "camions",
  "chauffeurs", "articles", "utilisateurs",
];

function hasRole(role) {
  return state.roles.includes(role);
}

/* --------------------------------------------------------- Helpers d'affichage */
function formatDateFr(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Puce de statut d'échéance : vert si lointaine, orange (surface, texte anthracite)
// si <= alerteJours, rouge si dépassée. Jamais de texte orange nu (cf. styles.css).
function statusPillHtml(iso, alerteJours = 60) {
  if (!iso) return "";
  const j = daysUntil(iso);
  if (j == null) return "";
  if (j < 0) return `<span class="status-pill status-expired">Expiré (${escapeHtml(formatDateFr(iso))})</span>`;
  if (j <= alerteJours) return `<span class="status-pill status-soon">Dans ${j} j (${escapeHtml(formatDateFr(iso))})</span>`;
  return `<span class="status-pill status-ok">${escapeHtml(formatDateFr(iso))}</span>`;
}

function getAlerteJours() {
  const v = state.reglages.alerte_jours;
  const n = v != null ? parseInt(v, 10) : NaN;
  return isNaN(n) ? 60 : n;
}

// Accordéon générique utilisé par tous les écrans bureau (Projets, Clients, Sites,
// Camions, Chauffeurs, Articles, Utilisateurs) : une carte repliée affiche
// titre + sous-titre + statut ; cliquer déplie le corps (formulaire autosave).
function createAccordionCard({ title, subtitle = "", metaHtml = "", bodyBuilder, startOpen = false }) {
  const card = document.createElement("article");
  card.className = "entity-card" + (startOpen ? " is-open" : "");

  const head = document.createElement("button");
  head.type = "button";
  head.className = "entity-card-head";
  head.innerHTML = `
    <span class="entity-card-title"><strong></strong><span></span></span>
    <span class="entity-card-meta">${metaHtml}<span class="entity-card-chevron" aria-hidden="true">▾</span></span>
  `;
  head.querySelector(".entity-card-title strong").textContent = title;
  head.querySelector(".entity-card-title span").textContent = subtitle;

  const body = document.createElement("div");
  body.className = "entity-card-body";

  head.addEventListener("click", () => {
    card.classList.toggle("is-open");
  });

  card.appendChild(head);
  card.appendChild(body);
  if (bodyBuilder) bodyBuilder(body, card);
  return card;
}

function wireFilterInput(inputEl, onFilter) {
  let t = null;
  inputEl.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => onFilter(inputEl.value.trim().toLowerCase()), 200);
  });
}

function fieldBlock(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function makeTextInput(type, value) {
  const el = document.createElement("input");
  el.type = type;
  if (value != null) el.value = value;
  return el;
}

function makeSelectInput(options, value, placeholder = "—") {
  const el = document.createElement("select");
  el.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = String(opt.value);
    o.textContent = opt.label;
    el.appendChild(o);
  }
  if (value != null) el.value = String(value);
  return el;
}

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
  const [camions, clients, projets, contacts, articles, sites, chauffeurs, reglages] = await Promise.all([
    listCamions().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listClients().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listProjets().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listContacts().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listArticles().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listSites().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listChauffeurs().catch(() => []),
    listReglages().catch(() => []),
  ]);
  state.refs = { camions, clients, projets, contacts, articles, sites, chauffeurs };
  state.reglages = Object.fromEntries(reglages.map((r) => [r.cle, r.valeur]));
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

/* ========================================================== Tableau de bord == */
async function loadDashboard() {
  const welcomeEl = document.getElementById("dashboard-welcome");
  const nom = (state.profil && (state.profil.nom || state.profil.email)) || "";
  welcomeEl.textContent = nom ? `Bonjour ${nom}.` : "";

  document.getElementById("dashboard-driver-cards").hidden = !hasRole("chauffeur");
  const bureauEl = document.getElementById("dashboard-bureau");
  bureauEl.hidden = !hasRole("bureau");
  if (!hasRole("bureau")) return;

  const tilesEl = document.getElementById("dashboard-tiles");
  const alertsEl = document.getElementById("dashboard-alerts");

  const today = todayIso();
  let lvToday = [];
  try {
    lvToday = await listLettresVoiture({ date: today });
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  tilesEl.innerHTML = `
    <div class="dash-tile"><strong>${lvToday.length}</strong><span>LV aujourd'hui</span></div>
    <div class="dash-tile"><strong>${state.refs.camions.length}</strong><span>Camions actifs</span></div>
    <div class="dash-tile"><strong>${state.refs.chauffeurs.filter((c) => c.actif).length}</strong><span>Chauffeurs actifs</span></div>
  `;

  const alerteJours = getAlerteJours();
  const rows = [];
  for (const c of state.refs.camions) {
    if (!c.actif) continue;
    for (const [label, date] of [["Contrôle technique", c.ct_echeance], ["Chronotachygraphe", c.chrono_echeance]]) {
      const j = daysUntil(date);
      if (j != null && j <= alerteJours) rows.push({ sujet: `Camion ${c.immatriculation}`, detail: label, date, j });
    }
  }
  // Les fiches chauffeur portent des colonnes "rapides" fco_echeance/carte_echeance
  // (historiques, cf. 0001_schema_bon.sql) ET des tables détaillées bon.fco /
  // bon.carte_conducteur (cf. 0011_driver_documents.sql) exposées par
  // api.alertes_documents(). On évite de compter deux fois la même échéance pour
  // le même chauffeur quand les deux sources existent.
  const docAlertKeys = new Set();
  let docs = [];
  try {
    docs = await rpcAlertesDocuments();
  } catch (e) {
    /* RLS bureau uniquement : ignore silencieusement si vide/erreur */
  }
  for (const d of docs) {
    rows.push({ sujet: d.chauffeur, detail: `${d.type_document}${d.detail ? " — " + d.detail : ""}`, date: d.echeance, j: d.jours_restants });
    if (/^FCO/.test(d.type_document)) docAlertKeys.add(d.chauffeur_id + "|fco");
    if (/^Carte conducteur/.test(d.type_document)) docAlertKeys.add(d.chauffeur_id + "|carte");
  }
  for (const c of state.refs.chauffeurs) {
    if (c.date_sortie) continue;
    for (const [label, date, key] of [["FCO / code 95", c.fco_echeance, "fco"], ["Carte conducteur", c.carte_echeance, "carte"]]) {
      if (docAlertKeys.has(c.id + "|" + key)) continue; // déjà couvert par le document détaillé
      const j = daysUntil(date);
      if (j != null && j <= alerteJours) rows.push({ sujet: c.nom, detail: label, date, j });
    }
  }

  if (!rows.length) {
    alertsEl.innerHTML = '<p class="muted">Aucune échéance proche.</p>';
    return;
  }
  rows.sort((a, b) => (a.j ?? 0) - (b.j ?? 0));
  alertsEl.innerHTML = rows
    .map((r) => {
      const expired = r.j != null && r.j < 0;
      return `
      <div class="dash-alert-row ${expired ? "is-expired" : "is-soon"}">
        <span class="dash-alert-main">${escapeHtml(r.sujet)}<span>${escapeHtml(r.detail)}</span></span>
        <span class="dash-alert-status">${escapeHtml(formatDateFr(r.date))}${r.j != null ? ` (${r.j} j)` : ""}</span>
      </div>`;
    })
    .join("");
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

  const pickerBtns = node.querySelectorAll(".btn-site-picker");
  pickerBtns[0].addEventListener("click", () => openSitePicker(chargementSel));
  pickerBtns[1].addEventListener("click", () => openSitePicker(dechargementSel));

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
    const data = await listLettresVoiture();
    if (!data || !data.length) {
      listEl.innerHTML = '<p class="muted">Aucune lettre de voiture.</p>';
      return;
    }
    listEl.innerHTML = "";
    for (const lv of data.slice(0, 30)) {
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

/* =============================================================== Réglages bureau == */
function wireReglageField(el, cle, transform) {
  autosaveField(el, {
    save: async (value) => {
      const v = transform ? transform(value) : value;
      await upsertReglage(cle, v == null ? null : String(v));
      state.reglages[cle] = v == null ? null : String(v);
    },
  });
}

function loadReglagesBureau() {
  const section = document.getElementById("reglages-bureau");
  section.hidden = !hasRole("bureau");
  if (!hasRole("bureau")) return;
  document.getElementById("r-signature-auto").checked = state.reglages.signature_envoi_auto === "true";
  document.getElementById("r-documenso-cc").value = state.reglages.documenso_cc_contact || "";
  document.getElementById("r-alerte-jours").value = state.reglages.alerte_jours || "";
  document.getElementById("r-retard-carte").value = state.reglages.carte_conducteur_retard_jours || "";
}

function wireReglagesBureauFields() {
  // Case à cocher : pas de wireReglageField (qui lit .value, pas .checked) —
  // même traitement manuel que f-dest-identique ailleurs dans ce fichier.
  const autoEl = document.getElementById("r-signature-auto");
  autoEl.addEventListener("change", async () => {
    try {
      await upsertReglage("signature_envoi_auto", autoEl.checked ? "true" : "false");
      state.reglages.signature_envoi_auto = autoEl.checked ? "true" : "false";
    } catch (e) {
      alert("Échec : " + (e.message || e));
    }
  });
  wireReglageField(document.getElementById("r-documenso-cc"), "documenso_cc_contact");
  wireReglageField(document.getElementById("r-alerte-jours"), "alerte_jours", toIntOrNull);
  wireReglageField(document.getElementById("r-retard-carte"), "carte_conducteur_retard_jours", toIntOrNull);
}

/* =========================================================================== LV == */
async function loadLvScreen() {
  const listEl = document.getElementById("list-lv");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  const render = async (query) => {
    let rows = [];
    try {
      rows = await listLettresVoiture({ query });
    } catch (e) {
      reportIfVersionMismatch(e);
    }
    if (!rows.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucune lettre de voiture.</p>';
      return;
    }
    listEl.innerHTML = "";
    for (const lv of rows) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "lv-row";
      row.innerHTML = `
        <span class="lv-row-main">
          <span class="lv-row-numero">${escapeHtml(lv.numero || "(brouillon)")}</span>
          <span class="lv-row-date">${escapeHtml(formatDateFr(lv.date_etablissement))}</span>
        </span>
        <span class="badge badge-${escapeHtml(lv.statut)}">${escapeHtml(lv.statut)}</span>
      `;
      row.addEventListener("click", () => openLvInToday(lv));
      listEl.appendChild(row);
    }
  };
  wireFilterInput(document.getElementById("filter-lv"), render);
  await render("");
}

/* ===================================================================== Planning == */
async function loadPlanning() {
  const listEl = document.getElementById("list-planning");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  state.planningSelection = new Set();
  refreshPlanningSelectionUi();
  let rows = [];
  try {
    rows = await listPlanningLv();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  if (!rows.length) {
    listEl.innerHTML = '<p class="entity-empty">Aucune LV préparée.</p>';
    return;
  }
  listEl.innerHTML = "";
  for (const lv of rows) listEl.appendChild(wirePlanningCard(renderPlanningCard(lv), lv));
}

function refreshPlanningSelectionUi() {
  const n = state.planningSelection.size;
  document.getElementById("planning-selection-count").textContent = `${n} sélectionnée(s)`;
  document.getElementById("btn-envoi-groupe").disabled = n === 0;
}

function renderPlanningCard(lv) {
  const client = state.refs.projets.find((p) => p.id === lv.projet_id);
  const clientNom = client ? (state.refs.clients.find((c) => c.id === client.client_id) || {}).raison_sociale : "";
  return createAccordionCard({
    title: lv.numero || `LV préparée — ${formatDateFr(lv.date_etablissement)}`,
    subtitle: clientNom || "Client non défini",
    metaHtml: `<label class="field-checkbox planning-check">
      <input type="checkbox" class="planning-select" data-lv-id="${lv.id}"> Envoyer
    </label>`,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const dateInput = makeTextInput("date", lv.date_etablissement);
      wireAutosaveField(dateInput, { table: "lettres_voiture", id: lv.id, field: "date_etablissement" });
      grid.appendChild(fieldBlock("Date d'établissement", dateInput));

      const camionSel = makeSelectInput(state.refs.camions.map((c) => ({ value: c.id, label: c.immatriculation })), lv.camion_id, "Camion…");
      wireAutosaveField(camionSel, { table: "lettres_voiture", id: lv.id, field: "camion_id", transform: toIntOrNull });
      grid.appendChild(fieldBlock("Camion", camionSel));

      const chauffeurSel = makeSelectInput(state.refs.chauffeurs.map((c) => ({ value: c.id, label: c.nom })), lv.chauffeur_id, "Chauffeur…");
      wireAutosaveField(chauffeurSel, { table: "lettres_voiture", id: lv.id, field: "chauffeur_id", transform: toIntOrNull });
      grid.appendChild(fieldBlock("Chauffeur", chauffeurSel));

      const projetSel = makeSelectInput(state.refs.projets.map((p) => ({ value: p.id, label: p.nom || p.ref_contrat || `Projet #${p.id}` })), lv.projet_id, "Projet…");
      wireAutosaveField(projetSel, { table: "lettres_voiture", id: lv.id, field: "projet_id", transform: toIntOrNull });
      grid.appendChild(fieldBlock("Projet", projetSel));

      body.appendChild(grid);
    },
  });
}

function wirePlanningCard(card, lv) {
  const checkbox = card.querySelector(".planning-select");
  // La case et son libellé ne doivent pas replier/déplier l'accordéon parent.
  const label = card.querySelector(".planning-check");
  if (label) label.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.planningSelection.add(String(lv.id));
    else state.planningSelection.delete(String(lv.id));
    refreshPlanningSelectionUi();
  });
  return card;
}

/* ===================================================================== Projets == */
async function loadProjetsScreen() {
  const listEl = document.getElementById("list-projets");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listProjets();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query
      ? rows
      : rows.filter((p) => {
          const client = state.refs.clients.find((c) => c.id === p.client_id);
          return (
            (p.nom || "").toLowerCase().includes(query) ||
            (p.ref_contrat || "").toLowerCase().includes(query) ||
            (client && client.raison_sociale.toLowerCase().includes(query))
          );
        });
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun projet.</p>';
      return;
    }
    for (const p of filtered) listEl.appendChild(renderProjetCard(p));
  };
  wireFilterInput(document.getElementById("filter-projets"), render);
  render("");

  document.getElementById("btn-new-projet").onclick = async () => {
    if (!state.refs.clients.length) {
      alert("Créez d'abord un client.");
      return;
    }
    try {
      const projet = await createProjet({ client_id: state.refs.clients[0].id, nom: "Nouveau projet", statut: "actif" });
      rows.unshift(projet);
      listEl.prepend(renderProjetCard(projet, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderProjetCard(p, startOpen = false) {
  const client = state.refs.clients.find((c) => c.id === p.client_id);
  return createAccordionCard({
    title: p.nom || p.ref_contrat || `Projet #${p.id}`,
    subtitle: client ? client.raison_sociale : "—",
    metaHtml: `<span class="badge badge-${escapeHtml(p.statut || "actif")}">${escapeHtml(p.statut || "actif")}</span>`,
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const nomInput = makeTextInput("text", p.nom);
      wireAutosaveField(nomInput, { table: "projets", id: p.id, field: "nom" });
      grid.appendChild(fieldBlock("Nom du projet", nomInput));

      const clientSel = makeSelectInput(state.refs.clients.map((c) => ({ value: c.id, label: c.raison_sociale })), p.client_id, "Client…");
      wireAutosaveField(clientSel, { table: "projets", id: p.id, field: "client_id", transform: toIntOrNull });
      grid.appendChild(fieldBlock("Client", clientSel));

      const refContratInput = makeTextInput("text", p.ref_contrat);
      wireAutosaveField(refContratInput, { table: "projets", id: p.id, field: "ref_contrat" });
      grid.appendChild(fieldBlock("Référence contrat", refContratInput));

      const refOmInput = makeTextInput("text", p.ref_ordre_mission);
      wireAutosaveField(refOmInput, { table: "projets", id: p.id, field: "ref_ordre_mission" });
      grid.appendChild(fieldBlock("Référence ordre de mission", refOmInput));

      const ligneRegieInput = makeTextInput("text", p.ligne_regie);
      wireAutosaveField(ligneRegieInput, { table: "projets", id: p.id, field: "ligne_regie" });
      grid.appendChild(fieldBlock("Ligne de régie", ligneRegieInput));

      const tarifInput = makeTextInput("number", p.tarif);
      tarifInput.step = "0.01";
      wireAutosaveField(tarifInput, { table: "projets", id: p.id, field: "tarif", transform: toFloatOrNull });
      grid.appendChild(fieldBlock("Tarif", tarifInput));

      const contacts = state.refs.contacts.filter((c) => c.client_id === p.client_id);
      const contactSel = makeSelectInput(contacts.map((c) => ({ value: c.id, label: c.nom })), p.contact_id, "Contact…");
      wireAutosaveField(contactSel, { table: "projets", id: p.id, field: "contact_id", transform: toIntOrNull });
      grid.appendChild(fieldBlock("Contact par défaut", contactSel));

      const debutInput = makeTextInput("date", p.date_debut);
      wireAutosaveField(debutInput, { table: "projets", id: p.id, field: "date_debut" });
      grid.appendChild(fieldBlock("Date de début", debutInput));

      const finInput = makeTextInput("date", p.date_fin);
      wireAutosaveField(finInput, { table: "projets", id: p.id, field: "date_fin" });
      grid.appendChild(fieldBlock("Date de fin", finInput));

      const statutSel = makeSelectInput(
        [{ value: "actif", label: "Actif" }, { value: "termine", label: "Terminé" }, { value: "suspendu", label: "Suspendu" }],
        p.statut,
        "Statut…"
      );
      wireAutosaveField(statutSel, { table: "projets", id: p.id, field: "statut" });
      grid.appendChild(fieldBlock("Statut", statutSel));

      body.appendChild(grid);
    },
  });
}

/* ===================================================================== Clients == */
async function loadClientsScreen() {
  const listEl = document.getElementById("list-clients");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listClients();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query ? rows : rows.filter((c) => c.raison_sociale.toLowerCase().includes(query));
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun client.</p>';
      return;
    }
    for (const c of filtered) listEl.appendChild(renderClientCard(c));
  };
  wireFilterInput(document.getElementById("filter-clients"), render);
  render("");

  document.getElementById("btn-new-client").onclick = async () => {
    try {
      const client = await createClient({ raison_sociale: "Nouveau client", actif: true });
      state.refs.clients.push(client);
      rows.unshift(client);
      listEl.prepend(renderClientCard(client, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderClientCard(c, startOpen = false) {
  return createAccordionCard({
    title: c.raison_sociale,
    subtitle: c.siren || "",
    metaHtml: c.actif ? "" : '<span class="status-pill status-expired">Inactif</span>',
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const nomInput = makeTextInput("text", c.raison_sociale);
      wireAutosaveField(nomInput, { table: "clients", id: c.id, field: "raison_sociale" });
      grid.appendChild(fieldBlock("Raison sociale", nomInput));

      const adresseInput = makeTextInput("text", c.adresse);
      wireAutosaveField(adresseInput, { table: "clients", id: c.id, field: "adresse" });
      grid.appendChild(fieldBlock("Adresse", adresseInput));

      const sirenInput = makeTextInput("text", c.siren);
      wireAutosaveField(sirenInput, { table: "clients", id: c.id, field: "siren" });
      grid.appendChild(fieldBlock("SIREN", sirenInput));

      const actifWrap = document.createElement("div");
      actifWrap.className = "field field-checkbox";
      const actifLabel = document.createElement("label");
      const actifInput = document.createElement("input");
      actifInput.type = "checkbox";
      actifInput.checked = c.actif !== false;
      actifLabel.appendChild(actifInput);
      actifLabel.append(" Client actif");
      actifWrap.appendChild(actifLabel);
      actifInput.addEventListener("change", async () => {
        try {
          await updateClient(c.id, { actif: actifInput.checked });
          c.actif = actifInput.checked;
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      grid.appendChild(actifWrap);

      body.appendChild(grid);

      // ---------------------------------------------------------------- Contacts
      const contactsTitle = document.createElement("div");
      contactsTitle.className = "sheet-section-title";
      contactsTitle.textContent = "Contacts";
      body.appendChild(contactsTitle);

      const contactsList = document.createElement("div");
      contactsList.className = "entity-list";
      body.appendChild(contactsList);

      const renderContacts = () => {
        contactsList.innerHTML = "";
        const contacts = state.refs.contacts.filter((ct) => ct.client_id === c.id);
        if (!contacts.length) {
          contactsList.innerHTML = '<p class="entity-empty">Aucun contact.</p>';
        }
        for (const contact of contacts) contactsList.appendChild(renderContactRow(contact, c, renderContacts));
      };
      renderContacts();

      const addContactBtn = document.createElement("button");
      addContactBtn.type = "button";
      addContactBtn.className = "btn btn-secondary btn-sm";
      addContactBtn.textContent = "+ Contact";
      addContactBtn.style.marginTop = "8px";
      addContactBtn.addEventListener("click", async () => {
        try {
          const contact = await createContact({ client_id: c.id, nom: "Nouveau contact", email: "a-completer@kerlam.fr", signataire: false });
          state.refs.contacts.push(contact);
          renderContacts();
        } catch (e) {
          alert("Création impossible : " + (e.message || e));
        }
      });
      body.appendChild(addContactBtn);
    },
  });
}

function renderContactRow(contact, client, onDeleted) {
  const card = createAccordionCard({
    title: contact.nom,
    subtitle: contact.email,
    metaHtml: contact.signataire ? '<span class="status-pill status-ok">Signataire</span>' : "",
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const nomInput = makeTextInput("text", contact.nom);
      wireAutosaveField(nomInput, { table: "contacts", id: contact.id, field: "nom" });
      grid.appendChild(fieldBlock("Nom", nomInput));

      const telInput = makeTextInput("tel", contact.tel);
      wireAutosaveField(telInput, { table: "contacts", id: contact.id, field: "tel" });
      grid.appendChild(fieldBlock("Téléphone", telInput));

      const emailInput = makeTextInput("email", contact.email);
      emailInput.required = true;
      wireAutosaveField(emailInput, { table: "contacts", id: contact.id, field: "email" });
      grid.appendChild(fieldBlock("E-mail (obligatoire)", emailInput));

      const fonctionInput = makeTextInput("text", contact.fonction);
      wireAutosaveField(fonctionInput, { table: "contacts", id: contact.id, field: "fonction" });
      grid.appendChild(fieldBlock("Fonction", fonctionInput));

      const signWrap = document.createElement("div");
      signWrap.className = "field field-checkbox";
      const signLabel = document.createElement("label");
      const signInput = document.createElement("input");
      signInput.type = "checkbox";
      signInput.checked = !!contact.signataire;
      signLabel.appendChild(signInput);
      signLabel.append(" Habilité à signer");
      signWrap.appendChild(signLabel);
      signInput.addEventListener("change", async () => {
        try {
          await updateContact(contact.id, { signataire: signInput.checked });
          contact.signataire = signInput.checked;
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      grid.appendChild(signWrap);

      body.appendChild(grid);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-secondary btn-sm";
      delBtn.textContent = "Supprimer ce contact";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Supprimer le contact ${contact.nom} ?`)) return;
        try {
          await deleteContact(contact.id);
          state.refs.contacts = state.refs.contacts.filter((c) => c.id !== contact.id);
          onDeleted();
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      body.appendChild(delBtn);
    },
  });
  return card;
}

/* ======================================================================= Sites == */
async function loadSitesScreen() {
  const listEl = document.getElementById("list-sites");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listSites();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query ? rows : rows.filter((s) => (s.nom + " " + (s.adresse || "")).toLowerCase().includes(query));
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun site.</p>';
      return;
    }
    for (const s of filtered) listEl.appendChild(renderSiteCard(s));
  };
  wireFilterInput(document.getElementById("filter-sites"), render);
  render("");

  document.getElementById("btn-new-site").onclick = async () => {
    try {
      const site = await createSite({ nom: "Nouveau site", portee: "commun", statut: "actif" });
      state.refs.sites.push(site);
      rows.unshift(site);
      listEl.prepend(renderSiteCard(site, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderSiteCard(s, startOpen = false) {
  return createAccordionCard({
    title: s.nom,
    subtitle: s.adresse || "",
    metaHtml: `<span class="badge badge-${s.portee === "chantier" ? "preparee" : "en_cours"}">${escapeHtml(s.portee)}</span>${s.statut === "termine" ? '<span class="status-pill status-expired">Terminé</span>' : ""}`,
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const nomInput = makeTextInput("text", s.nom);
      wireAutosaveField(nomInput, { table: "sites", id: s.id, field: "nom" });
      grid.appendChild(fieldBlock("Nom", nomInput));

      const porteeSel = makeSelectInput([{ value: "commun", label: "Commun" }, { value: "chantier", label: "Chantier" }], s.portee);
      grid.appendChild(fieldBlock("Portée", porteeSel));

      const clientBlock = fieldBlock("Client (chantier uniquement)", makeSelectInput(state.refs.clients.map((c) => ({ value: c.id, label: c.raison_sociale })), s.client_id, "Client…"));
      const clientSel = clientBlock.querySelector("select");
      clientBlock.hidden = s.portee !== "chantier";
      grid.appendChild(clientBlock);

      porteeSel.addEventListener("change", async () => {
        clientBlock.hidden = porteeSel.value !== "chantier";
        try {
          const patch = { portee: porteeSel.value };
          if (porteeSel.value === "commun") patch.client_id = null;
          await updateSite(s.id, patch);
          Object.assign(s, patch);
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      wireAutosaveField(clientSel, { table: "sites", id: s.id, field: "client_id", transform: toIntOrNull });

      // ----------------------------------------------------------- Adresse + autocomplétion
      const addrWrap = document.createElement("div");
      addrWrap.className = "field autocomplete-wrap";
      const addrLabel = document.createElement("label");
      addrLabel.textContent = "Adresse";
      const addrInput = makeTextInput("text", s.adresse);
      const suggestList = document.createElement("ul");
      suggestList.className = "autocomplete-list";
      suggestList.hidden = true;
      addrWrap.append(addrLabel, addrInput, suggestList);
      grid.appendChild(addrWrap);

      const latInput = makeTextInput("number", s.lat);
      latInput.step = "0.00001";
      const lonInput = makeTextInput("number", s.lon);
      lonInput.step = "0.00001";
      grid.appendChild(fieldBlock("Latitude", latInput));
      grid.appendChild(fieldBlock("Longitude", lonInput));

      wireAutosaveField(addrInput, { table: "sites", id: s.id, field: "adresse" });
      wireAutosaveField(latInput, { table: "sites", id: s.id, field: "lat", transform: toFloatOrNull });
      wireAutosaveField(lonInput, { table: "sites", id: s.id, field: "lon", transform: toFloatOrNull });

      wireAddressAutocomplete(addrInput, suggestList, (picked) => {
        addrInput.value = picked.label;
        addrInput.dispatchEvent(new Event("input"));
        latInput.value = picked.lat;
        latInput.dispatchEvent(new Event("input"));
        lonInput.value = picked.lon;
        lonInput.dispatchEvent(new Event("input"));
      });

      const geolocRow = document.createElement("div");
      geolocRow.className = "geoloc-row";
      const geolocBtn = document.createElement("button");
      geolocBtn.type = "button";
      geolocBtn.className = "btn btn-secondary btn-sm";
      geolocBtn.textContent = "Ma position";
      geolocBtn.addEventListener("click", () => handleGeolocateSite(latInput, lonInput, addrInput));
      geolocRow.appendChild(geolocBtn);
      grid.appendChild(geolocRow);

      const statutSel = makeSelectInput([{ value: "actif", label: "Actif" }, { value: "termine", label: "Terminé" }], s.statut);
      wireAutosaveField(statutSel, { table: "sites", id: s.id, field: "statut" });
      grid.appendChild(fieldBlock("Statut", statutSel));

      body.appendChild(grid);
    },
  });
}

function wireAddressAutocomplete(inputEl, listEl, onPick) {
  let timer = null;
  inputEl.addEventListener("input", () => {
    clearTimeout(timer);
    const q = inputEl.value;
    timer = setTimeout(async () => {
      if (!q || q.trim().length < 3) {
        listEl.hidden = true;
        return;
      }
      let results = [];
      try {
        results = await searchAddress(q);
      } catch (e) {
        /* réseau indisponible : pas de suggestion, pas d'erreur bloquante */
      }
      if (!results.length) {
        listEl.hidden = true;
        return;
      }
      listEl.innerHTML = "";
      for (const r of results) {
        const li = document.createElement("li");
        li.className = "autocomplete-item";
        li.textContent = r.label;
        li.addEventListener("click", () => {
          onPick(r);
          listEl.hidden = true;
        });
        listEl.appendChild(li);
      }
      listEl.hidden = false;
    }, 300);
  });
  inputEl.addEventListener("blur", () => setTimeout(() => (listEl.hidden = true), 150));
}

function handleGeolocateSite(latInput, lonInput, addrInput) {
  if (!navigator.geolocation) {
    alert("Géolocalisation non disponible sur cet appareil.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      latInput.value = latitude;
      latInput.dispatchEvent(new Event("input"));
      lonInput.value = longitude;
      lonInput.dispatchEvent(new Event("input"));
      try {
        const rev = await reverseAddress(latitude, longitude);
        if (rev) {
          addrInput.value = rev.label;
          addrInput.dispatchEvent(new Event("input"));
        }
      } catch (e) {
        /* l'utilisateur vérifie/complète l'adresse manuellement */
      }
    },
    () => alert("Impossible d'obtenir la position (autorisation refusée ?)."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/* ===================================================================== Camions == */
async function loadCamionsScreen() {
  const listEl = document.getElementById("list-camions");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listCamions();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query ? rows : rows.filter((c) => c.immatriculation.toLowerCase().includes(query));
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun camion.</p>';
      return;
    }
    for (const c of filtered) listEl.appendChild(renderCamionCard(c));
  };
  wireFilterInput(document.getElementById("filter-camions"), render);
  render("");

  document.getElementById("btn-new-camion").onclick = async () => {
    const immat = prompt("Immatriculation du nouveau camion :");
    if (!immat) return;
    try {
      const camion = await createCamion({ immatriculation: immat.toUpperCase(), actif: true });
      state.refs.camions.push(camion);
      rows.unshift(camion);
      listEl.prepend(renderCamionCard(camion, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderCamionCard(c, startOpen = false) {
  const alerteJours = getAlerteJours();
  return createAccordionCard({
    title: c.immatriculation,
    subtitle: c.type || "",
    metaHtml: (statusPillHtml(c.ct_echeance, alerteJours) || "") + (c.actif ? "" : '<span class="status-pill status-expired">Inactif</span>'),
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const immatInput = makeTextInput("text", c.immatriculation);
      wireAutosaveField(immatInput, { table: "camions", id: c.id, field: "immatriculation", transform: (v) => (v ? v.toUpperCase() : null) });
      grid.appendChild(fieldBlock("Immatriculation", immatInput));

      const typeInput = makeTextInput("text", c.type);
      wireAutosaveField(typeInput, { table: "camions", id: c.id, field: "type" });
      grid.appendChild(fieldBlock("Type", typeInput));

      const ptacInput = makeTextInput("number", c.ptac_kg);
      wireAutosaveField(ptacInput, { table: "camions", id: c.id, field: "ptac_kg", transform: toIntOrNull });
      grid.appendChild(fieldBlock("PTAC (kg)", ptacInput));

      const videInput = makeTextInput("number", c.poids_vide_kg);
      wireAutosaveField(videInput, { table: "camions", id: c.id, field: "poids_vide_kg", transform: toIntOrNull });
      grid.appendChild(fieldBlock("Poids à vide (kg)", videInput));

      const volInput = makeTextInput("number", c.volume_benne_m3);
      volInput.step = "0.1";
      wireAutosaveField(volInput, { table: "camions", id: c.id, field: "volume_benne_m3", transform: toFloatOrNull });
      grid.appendChild(fieldBlock("Volume benne (m³)", volInput));

      const ctInput = makeTextInput("date", c.ct_echeance);
      wireAutosaveField(ctInput, { table: "camions", id: c.id, field: "ct_echeance" });
      grid.appendChild(fieldBlock("Échéance contrôle technique", ctInput));

      const chronoInput = makeTextInput("date", c.chrono_echeance);
      wireAutosaveField(chronoInput, { table: "camions", id: c.id, field: "chrono_echeance" });
      grid.appendChild(fieldBlock("Échéance chronotachygraphe", chronoInput));

      const actifWrap = document.createElement("div");
      actifWrap.className = "field field-checkbox";
      const actifLabel = document.createElement("label");
      const actifInput = document.createElement("input");
      actifInput.type = "checkbox";
      actifInput.checked = c.actif !== false;
      actifLabel.append(actifInput, " Camion en service");
      actifWrap.appendChild(actifLabel);
      actifInput.addEventListener("change", async () => {
        try {
          await updateCamion(c.id, { actif: actifInput.checked });
          c.actif = actifInput.checked;
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      grid.appendChild(actifWrap);

      body.appendChild(grid);
    },
  });
}

/* ================================================================== Chauffeurs == */
async function loadChauffeursScreen() {
  const listEl = document.getElementById("list-chauffeurs");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listChauffeurs();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query ? rows : rows.filter((c) => c.nom.toLowerCase().includes(query) || (c.email || "").toLowerCase().includes(query));
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun chauffeur.</p>';
      return;
    }
    for (const c of filtered) listEl.appendChild(renderChauffeurCard(c));
  };
  wireFilterInput(document.getElementById("filter-chauffeurs"), render);
  render("");

  document.getElementById("btn-new-chauffeur").onclick = async () => {
    const nom = prompt("Nom du nouveau chauffeur :");
    if (!nom) return;
    try {
      const chauffeur = await createChauffeur({ nom, actif: true });
      state.refs.chauffeurs.push(chauffeur);
      rows.unshift(chauffeur);
      listEl.prepend(renderChauffeurCard(chauffeur, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderChauffeurCard(c, startOpen = false) {
  const alerteJours = getAlerteJours();
  return createAccordionCard({
    title: c.nom,
    subtitle: c.email || "",
    metaHtml: (statusPillHtml(c.fco_echeance, alerteJours) || "") + (c.date_sortie ? '<span class="status-pill status-expired">Parti le ' + escapeHtml(formatDateFr(c.date_sortie)) + "</span>" : ""),
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const nomInput = makeTextInput("text", c.nom);
      wireAutosaveField(nomInput, { table: "chauffeurs", id: c.id, field: "nom" });
      grid.appendChild(fieldBlock("Nom", nomInput));

      const telInput = makeTextInput("tel", c.tel);
      wireAutosaveField(telInput, { table: "chauffeurs", id: c.id, field: "tel" });
      grid.appendChild(fieldBlock("Téléphone", telInput));

      const emailInput = makeTextInput("email", c.email);
      wireAutosaveField(emailInput, { table: "chauffeurs", id: c.id, field: "email" });
      grid.appendChild(fieldBlock("E-mail (connexion Google)", emailInput));

      const camionSel = makeSelectInput(state.refs.camions.map((cam) => ({ value: cam.id, label: cam.immatriculation })), c.camion_id, "Camion attribué…");
      wireAutosaveField(camionSel, { table: "chauffeurs", id: c.id, field: "camion_id", transform: toIntOrNull });
      grid.appendChild(fieldBlock("Camion attribué", camionSel));

      const fcoInput = makeTextInput("date", c.fco_echeance);
      wireAutosaveField(fcoInput, { table: "chauffeurs", id: c.id, field: "fco_echeance" });
      grid.appendChild(fieldBlock("Échéance FCO / code 95", fcoInput));

      const carteInput = makeTextInput("date", c.carte_echeance);
      wireAutosaveField(carteInput, { table: "chauffeurs", id: c.id, field: "carte_echeance" });
      grid.appendChild(fieldBlock("Échéance carte conducteur", carteInput));

      const navSel = makeSelectInput(
        [{ value: "google_maps", label: "Google Maps" }, { value: "waze", label: "Waze" }, { value: "apple_plans", label: "Plans (Apple)" }],
        c.nav_app
      );
      wireAutosaveField(navSel, { table: "chauffeurs", id: c.id, field: "nav_app" });
      grid.appendChild(fieldBlock("Application de navigation", navSel));

      const themeSel = makeSelectInput([{ value: "auto", label: "Auto" }, { value: "clair", label: "Clair" }, { value: "sombre", label: "Sombre" }], c.theme);
      wireAutosaveField(themeSel, { table: "chauffeurs", id: c.id, field: "theme" });
      grid.appendChild(fieldBlock("Thème", themeSel));

      const actifWrap = document.createElement("div");
      actifWrap.className = "field field-checkbox";
      const actifLabel = document.createElement("label");
      const actifInput = document.createElement("input");
      actifInput.type = "checkbox";
      actifInput.checked = c.actif !== false;
      actifLabel.append(actifInput, " Chauffeur en service");
      actifWrap.appendChild(actifLabel);
      actifInput.addEventListener("change", async () => {
        try {
          await updateChauffeur(c.id, { actif: actifInput.checked });
          c.actif = actifInput.checked;
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      grid.appendChild(actifWrap);

      body.appendChild(grid);

      if (hasRole("bureau")) {
        const departBtn = document.createElement("button");
        departBtn.type = "button";
        departBtn.className = "btn btn-secondary";
        departBtn.textContent = "Départ du salarié";
        departBtn.addEventListener("click", async () => {
          if (!confirm(`Confirmer le départ de ${c.nom} ? Les scans de documents seront purgés.`)) return;
          try {
            await workerChauffeurDepart(c.id);
            c.date_sortie = todayIso();
            alert("Départ enregistré, documents purgés.");
            await loadChauffeursScreen();
          } catch (e) {
            alert("Le service bon-worker n'a pas répondu (jeton IA requis côté serveur) : " + (e.message || e));
          }
        });
        body.appendChild(departBtn);

        buildChauffeurDocsPanel(body, c);
      }
    },
  });
}

/* --------------------------------------------- Documents réglementaires (bureau) */
function buildChauffeurDocsPanel(container, chauffeur) {
  const wrap = document.createElement("div");
  wrap.innerHTML = '<div class="sheet-section-title is-spaced">Documents réglementaires (bureau)</div>';
  container.appendChild(wrap);

  const panel = document.createElement("div");
  panel.innerHTML = '<p class="muted">Chargement des documents…</p>';
  container.appendChild(panel);

  (async () => {
    let permis, fco, carte, cacesList, categories;
    try {
      [permis, fco, carte, cacesList, categories] = await Promise.all([
        getPermis(chauffeur.id).catch(() => null),
        getFco(chauffeur.id).catch(() => null),
        getCarteConducteur(chauffeur.id).catch(() => null),
        listCaces(chauffeur.id).catch(() => []),
        listPermisCategories(chauffeur.id).catch(() => []),
      ]);
    } catch (e) {
      panel.innerHTML = '<p class="muted">Documents indisponibles.</p>';
      return;
    }
    panel.innerHTML = "";
    panel.appendChild(buildPermisSection(chauffeur, permis, categories));
    panel.appendChild(buildFcoSection(chauffeur, fco));
    panel.appendChild(buildCarteConducteurSection(chauffeur, carte));
    panel.appendChild(buildCacesSection(chauffeur, cacesList));
  })();
}

function docScanUploadRow(chauffeurId, docKind, side, currentPath, onSaved) {
  const row = document.createElement("span");
  row.className = "upload-row";
  const label = document.createElement("label");
  label.className = "upload-label";
  label.textContent = currentPath ? `${side} (chargé)` : `Scan ${side}`;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,application/pdf";
  label.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const path = `${chauffeurId}/${docKind}-${side}-${Date.now()}-${file.name}`;
    try {
      await uploadChauffeurDoc(path, file);
      await onSaved(path);
      label.textContent = `${side} (chargé)`;
    } catch (e) {
      alert("Échec de l'envoi du scan : " + (e.message || e));
    }
  });
  row.appendChild(label);
  if (currentPath) {
    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn btn-secondary btn-sm";
    viewBtn.textContent = "Voir";
    viewBtn.addEventListener("click", async () => {
      try {
        const url = await signedUrlChauffeurDoc(currentPath);
        window.open(url, "_blank", "noopener");
      } catch (e) {
        alert("Impossible d'ouvrir le scan : " + (e.message || e));
      }
    });
    row.appendChild(viewBtn);
  }
  return row;
}

function buildPermisSection(chauffeur, permis, categories) {
  const p = permis || {};
  const section = document.createElement("div");
  section.className = "doc-section";
  section.innerHTML = '<div class="doc-section-title">Permis de conduire</div>';

  const row1 = document.createElement("div");
  row1.className = "doc-row";
  const numInput = makeTextInput("text", p.numero);
  wireAutosaveField(numInput, { table: "permis", id: chauffeur.id, field: "numero" });
  row1.appendChild(fieldBlock("Numéro", numInput));
  const visiteInput = makeTextInput("date", p.visite_medicale);
  wireAutosaveField(visiteInput, { table: "permis", id: chauffeur.id, field: "visite_medicale" });
  row1.appendChild(fieldBlock("Visite médicale", visiteInput));
  section.appendChild(row1);

  const catsTitle = document.createElement("div");
  catsTitle.className = "sheet-section-title";
  catsTitle.textContent = "Catégories";
  section.appendChild(catsTitle);
  const catsList = document.createElement("div");
  catsList.className = "doc-cat-list";
  section.appendChild(catsList);

  const renderCats = (cats) => {
    catsList.innerHTML = "";
    for (const cat of cats) {
      const tpl = document.getElementById("tpl-doc-cat-row");
      const node = tpl.content.firstElementChild.cloneNode(true);
      const codeInput = node.querySelector(".f-cat-code");
      const validiteInput = node.querySelector(".f-cat-validite");
      codeInput.value = cat.categorie || "";
      validiteInput.value = cat.validite || "";
      wireAutosaveField(codeInput, { table: "permis_categories", id: cat.id, field: "categorie" });
      wireAutosaveField(validiteInput, { table: "permis_categories", id: cat.id, field: "validite" });
      node.querySelector(".btn-delete-cat").addEventListener("click", async () => {
        try {
          await deletePermisCategorie(cat.id);
          node.remove();
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      catsList.appendChild(node);
    }
  };
  renderCats(categories || []);

  const addCatBtn = document.createElement("button");
  addCatBtn.type = "button";
  addCatBtn.className = "btn btn-secondary btn-sm";
  addCatBtn.textContent = "+ Catégorie";
  addCatBtn.addEventListener("click", async () => {
    try {
      const cat = await createPermisCategorie(chauffeur.id, "B", null);
      const tpl = document.getElementById("tpl-doc-cat-row");
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector(".f-cat-code").value = cat.categorie;
      wireAutosaveField(node.querySelector(".f-cat-code"), { table: "permis_categories", id: cat.id, field: "categorie" });
      wireAutosaveField(node.querySelector(".f-cat-validite"), { table: "permis_categories", id: cat.id, field: "validite" });
      node.querySelector(".btn-delete-cat").addEventListener("click", async () => {
        await deletePermisCategorie(cat.id).catch(() => {});
        node.remove();
      });
      catsList.appendChild(node);
    } catch (e) {
      alert("Échec : " + (e.message || e));
    }
  });
  section.appendChild(addCatBtn);

  const uploadRow = document.createElement("div");
  uploadRow.className = "doc-row";
  uploadRow.appendChild(docScanUploadRow(chauffeur.id, "permis", "recto", p.scan_recto, async (path) => {
    await upsertPermis(chauffeur.id, { scan_recto: path });
    p.scan_recto = path;
  }));
  uploadRow.appendChild(docScanUploadRow(chauffeur.id, "permis", "verso", p.scan_verso, async (path) => {
    await upsertPermis(chauffeur.id, { scan_verso: path });
    p.scan_verso = path;
  }));
  section.appendChild(uploadRow);

  return section;
}

function buildFcoSection(chauffeur, fco) {
  const f = fco || {};
  const section = document.createElement("div");
  section.className = "doc-section";
  section.innerHTML = '<div class="doc-section-title">FCO / code 95</div>';

  const row = document.createElement("div");
  row.className = "doc-row";
  const numInput = makeTextInput("text", f.numero);
  wireAutosaveField(numInput, { table: "fco", id: chauffeur.id, field: "numero" });
  row.appendChild(fieldBlock("Numéro", numInput));
  const delivInput = makeTextInput("date", f.delivrance);
  wireAutosaveField(delivInput, { table: "fco", id: chauffeur.id, field: "delivrance" });
  row.appendChild(fieldBlock("Délivrance", delivInput));
  const expInput = makeTextInput("date", f.expiration);
  wireAutosaveField(expInput, { table: "fco", id: chauffeur.id, field: "expiration" });
  row.appendChild(fieldBlock("Expiration", expInput));
  section.appendChild(row);

  const uploadRow = document.createElement("div");
  uploadRow.className = "doc-row";
  uploadRow.appendChild(docScanUploadRow(chauffeur.id, "fco", "recto", f.scan_recto, async (path) => upsertFco(chauffeur.id, { scan_recto: path })));
  uploadRow.appendChild(docScanUploadRow(chauffeur.id, "fco", "verso", f.scan_verso, async (path) => upsertFco(chauffeur.id, { scan_verso: path })));
  section.appendChild(uploadRow);

  return section;
}

function buildCarteConducteurSection(chauffeur, carte) {
  const cc = carte || {};
  const section = document.createElement("div");
  section.className = "doc-section";
  section.innerHTML = '<div class="doc-section-title">Carte conducteur (chronotachygraphe)</div>';

  const row = document.createElement("div");
  row.className = "doc-row";
  const numInput = makeTextInput("text", cc.numero);
  wireAutosaveField(numInput, { table: "carte_conducteur", id: chauffeur.id, field: "numero" });
  row.appendChild(fieldBlock("Numéro", numInput));
  const expInput = makeTextInput("date", cc.expiration);
  wireAutosaveField(expInput, { table: "carte_conducteur", id: chauffeur.id, field: "expiration" });
  row.appendChild(fieldBlock("Expiration", expInput));
  const dlInput = makeTextInput("date", cc.dernier_telechargement);
  wireAutosaveField(dlInput, { table: "carte_conducteur", id: chauffeur.id, field: "dernier_telechargement" });
  row.appendChild(fieldBlock("Dernier téléchargement", dlInput));
  section.appendChild(row);

  const uploadRow = document.createElement("div");
  uploadRow.className = "doc-row";
  uploadRow.appendChild(docScanUploadRow(chauffeur.id, "carte", "recto", cc.scan_recto, async (path) => upsertCarteConducteur(chauffeur.id, { scan_recto: path })));
  uploadRow.appendChild(docScanUploadRow(chauffeur.id, "carte", "verso", cc.scan_verso, async (path) => upsertCarteConducteur(chauffeur.id, { scan_verso: path })));
  section.appendChild(uploadRow);

  return section;
}

function buildCacesSection(chauffeur, cacesList) {
  const section = document.createElement("div");
  section.className = "doc-section";
  section.innerHTML = '<div class="doc-section-title">CACES</div>';

  const list = document.createElement("div");
  list.className = "doc-cat-list";
  section.appendChild(list);

  const renderRow = (c) => {
    const tpl = document.getElementById("tpl-caces-row");
    const node = tpl.content.firstElementChild.cloneNode(true);
    const typeInput = node.querySelector(".f-caces-type");
    const catInput = node.querySelector(".f-caces-categories");
    const expInput = node.querySelector(".f-caces-expiration");
    typeInput.value = c.type || "";
    catInput.value = (c.categories || []).join(", ");
    expInput.value = c.expiration || "";
    wireAutosaveField(typeInput, { table: "caces", id: c.id, field: "type" });
    wireAutosaveField(catInput, { table: "caces", id: c.id, field: "categories", transform: (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []) });
    wireAutosaveField(expInput, { table: "caces", id: c.id, field: "expiration" });
    node.querySelector(".btn-delete-caces").addEventListener("click", async () => {
      try {
        await deleteCaces(c.id);
        node.remove();
      } catch (e) {
        alert("Échec : " + (e.message || e));
      }
    });
    list.appendChild(node);
  };
  for (const c of cacesList || []) renderRow(c);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-secondary btn-sm";
  addBtn.textContent = "+ CACES";
  addBtn.addEventListener("click", async () => {
    try {
      const c = await createCaces(chauffeur.id, { type: "R482", categories: [], expiration: null });
      renderRow(c);
    } catch (e) {
      alert("Échec : " + (e.message || e));
    }
  });
  section.appendChild(addBtn);

  return section;
}

/* =================================================================== Articles == */
async function loadArticlesScreen() {
  const listEl = document.getElementById("list-articles");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listArticlesAll();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query ? rows : rows.filter((a) => a.nom.toLowerCase().includes(query));
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun article.</p>';
      return;
    }
    for (const a of filtered) listEl.appendChild(renderArticleCard(a, rows));
  };
  wireFilterInput(document.getElementById("filter-articles"), render);
  render("");

  document.getElementById("btn-new-article").onclick = async () => {
    const nom = prompt("Nom du nouvel article :");
    if (!nom) return;
    try {
      const article = await createArticle({ nom, unites: ["t"], actif: true });
      state.refs.articles.push(article);
      rows.unshift(article);
      listEl.prepend(renderArticleCard(article, rows, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderArticleCard(a, allRows, startOpen = false) {
  return createAccordionCard({
    title: a.nom,
    subtitle: a.commentaire_interne ? a.commentaire_interne.slice(0, 60) : "",
    metaHtml: a.actif ? "" : '<span class="status-pill status-expired">Inactif</span>',
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const nomInput = makeTextInput("text", a.nom);
      wireAutosaveField(nomInput, { table: "articles", id: a.id, field: "nom" });
      grid.appendChild(fieldBlock("Nom (imprimé sur la LV)", nomInput));

      const comInput = document.createElement("textarea");
      comInput.value = a.commentaire_interne || "";
      comInput.rows = 2;
      wireAutosaveField(comInput, { table: "articles", id: a.id, field: "commentaire_interne" });
      grid.appendChild(fieldBlock("Commentaire interne (jamais imprimé)", comInput));

      const densiteInput = makeTextInput("number", a.densite_t_m3);
      densiteInput.step = "0.0001";
      wireAutosaveField(densiteInput, { table: "articles", id: a.id, field: "densite_t_m3", transform: toFloatOrNull });
      grid.appendChild(fieldBlock("Densité (t/m³)", densiteInput));

      const poidsUInput = makeTextInput("number", a.poids_unitaire_t);
      poidsUInput.step = "0.0001";
      wireAutosaveField(poidsUInput, { table: "articles", id: a.id, field: "poids_unitaire_t", transform: toFloatOrNull });
      grid.appendChild(fieldBlock("Poids unitaire (t/unité)", poidsUInput));

      body.appendChild(grid);

      const unitesTitle = document.createElement("div");
      unitesTitle.className = "sheet-section-title";
      unitesTitle.textContent = "Unités disponibles";
      body.appendChild(unitesTitle);
      const chipRow = document.createElement("div");
      chipRow.className = "chip-row";
      const currentUnites = new Set(a.unites || []);
      for (const [value, label] of [["t", "tonne"], ["m3", "m³"], ["unite", "unité"]]) {
        const chip = document.createElement("label");
        chip.className = "chip-check" + (currentUnites.has(value) ? " is-checked" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = currentUnites.has(value);
        chip.append(cb, " " + label);
        cb.addEventListener("change", async () => {
          if (cb.checked) currentUnites.add(value);
          else currentUnites.delete(value);
          chip.classList.toggle("is-checked", cb.checked);
          try {
            await updateArticle(a.id, { unites: Array.from(currentUnites) });
            a.unites = Array.from(currentUnites);
          } catch (e) {
            alert("Échec : " + (e.message || e));
          }
        });
        chipRow.appendChild(chip);
      }
      body.appendChild(chipRow);

      const actifWrap = document.createElement("div");
      actifWrap.className = "field field-checkbox";
      actifWrap.style.marginTop = "12px";
      const actifLabel = document.createElement("label");
      const actifInput = document.createElement("input");
      actifInput.type = "checkbox";
      actifInput.checked = a.actif !== false;
      actifLabel.append(actifInput, " Article actif");
      actifWrap.appendChild(actifLabel);
      actifInput.addEventListener("change", async () => {
        try {
          await updateArticle(a.id, { actif: actifInput.checked });
          a.actif = actifInput.checked;
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      body.appendChild(actifWrap);

      const fusionBtn = document.createElement("button");
      fusionBtn.type = "button";
      fusionBtn.className = "btn btn-secondary";
      fusionBtn.style.marginTop = "10px";
      fusionBtn.textContent = "Fusionner avec…";
      fusionBtn.addEventListener("click", () => handleFusionArticle(a, allRows));
      body.appendChild(fusionBtn);
    },
  });
}

async function handleFusionArticle(article, allRows) {
  const others = allRows.filter((r) => r.id !== article.id);
  if (!others.length) {
    alert("Aucun autre article à fusionner.");
    return;
  }
  const choice = prompt(
    "Fusionner « " + article.nom + " » avec quel article ? Tapez le nom exact :\n" + others.map((o) => "- " + o.nom).join("\n")
  );
  if (!choice) return;
  const target = others.find((o) => o.nom.toLowerCase() === choice.trim().toLowerCase());
  if (!target) {
    alert("Article introuvable.");
    return;
  }
  try {
    await rpcFusionnerArticle(article.id, target.id);
    alert("Fusion effectuée.");
  } catch (e) {
    alert(
      "Fusion non disponible dans cette bêta : aucune fonction serveur dédiée n'existe encore " +
        "(cf. supabase/migrations). Demandez au bureau de fusionner manuellement en désactivant " +
        "« " + article.nom + " » et en reportant ses lignes sur « " + target.nom + " »."
    );
  }
}

/* =============================================================== Utilisateurs == */
async function loadUtilisateursScreen() {
  const listEl = document.getElementById("list-utilisateurs");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listUtilisateurs();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query ? rows : rows.filter((u) => u.email.toLowerCase().includes(query) || (u.nom || "").toLowerCase().includes(query));
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun utilisateur.</p>';
      return;
    }
    for (const u of filtered) listEl.appendChild(renderUtilisateurCard(u));
  };
  wireFilterInput(document.getElementById("filter-utilisateurs"), render);
  render("");

  document.getElementById("btn-new-utilisateur").onclick = async () => {
    const email = prompt("E-mail du nouvel utilisateur :");
    if (!email) return;
    try {
      const u = await createUtilisateur({ email, role: "chauffeur", roles: ["chauffeur"], actif: true });
      rows.unshift(u);
      listEl.prepend(renderUtilisateurCard(u, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderUtilisateurCard(u, startOpen = false) {
  return createAccordionCard({
    title: u.email,
    subtitle: u.nom || "",
    metaHtml: (u.roles || []).map((r) => `<span class="badge badge-en_cours">${escapeHtml(r)}</span>`).join(""),
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const emailInput = makeTextInput("email", u.email);
      wireAutosaveField(emailInput, { table: "utilisateurs", id: u.id, field: "email" });
      grid.appendChild(fieldBlock("E-mail", emailInput));

      const nomInput = makeTextInput("text", u.nom);
      wireAutosaveField(nomInput, { table: "utilisateurs", id: u.id, field: "nom" });
      grid.appendChild(fieldBlock("Nom", nomInput));

      body.appendChild(grid);

      const rolesTitle = document.createElement("div");
      rolesTitle.className = "sheet-section-title";
      rolesTitle.textContent = "Rôles";
      body.appendChild(rolesTitle);
      const chipRow = document.createElement("div");
      chipRow.className = "chip-row";
      const currentRoles = new Set(u.roles || []);
      for (const [value, label] of [["chauffeur", "Chauffeur"], ["bureau", "Bureau"]]) {
        const chip = document.createElement("label");
        chip.className = "chip-check" + (currentRoles.has(value) ? " is-checked" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = currentRoles.has(value);
        chip.append(cb, " " + label);
        cb.addEventListener("change", async () => {
          if (cb.checked) currentRoles.add(value);
          else currentRoles.delete(value);
          chip.classList.toggle("is-checked", cb.checked);
          const rolesArr = Array.from(currentRoles);
          try {
            await updateUtilisateur(u.id, { roles: rolesArr, role: rolesArr.includes("bureau") ? "bureau" : rolesArr.includes("chauffeur") ? "chauffeur" : "desactive" });
            u.roles = rolesArr;
          } catch (e) {
            alert("Échec : " + (e.message || e));
          }
        });
        chipRow.appendChild(chip);
      }
      body.appendChild(chipRow);

      const actifWrap = document.createElement("div");
      actifWrap.className = "field field-checkbox";
      actifWrap.style.marginTop = "12px";
      const actifLabel = document.createElement("label");
      const actifInput = document.createElement("input");
      actifInput.type = "checkbox";
      actifInput.checked = u.actif !== false;
      actifLabel.append(actifInput, " Compte actif");
      actifWrap.appendChild(actifLabel);
      actifInput.addEventListener("change", async () => {
        try {
          await updateUtilisateur(u.id, { actif: actifInput.checked });
          u.actif = actifInput.checked;
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      body.appendChild(actifWrap);
    },
  });
}

/* =============================================================== Choix de site == */
function openSitePicker(targetSelect) {
  state.sitePickerTarget = targetSelect;
  const sheet = document.getElementById("site-picker-sheet");
  sheet.hidden = false;
  document.getElementById("site-picker-search").value = "";
  renderSitePickerList("");
}
function closeSitePicker() {
  document.getElementById("site-picker-sheet").hidden = true;
  state.sitePickerTarget = null;
}
async function renderSitePickerList(query) {
  const listEl = document.getElementById("site-picker-list");
  const clientId = document.getElementById("f-client").value;
  let ranked = [];
  try {
    ranked = state.chauffeur && clientId ? await rpcSitesPour(state.chauffeur.id, parseInt(clientId, 10)) : [];
  } catch (e) {
    /* on retombe sur la liste plate */
  }
  const needle = (query || "").toLowerCase();
  const all = state.refs.sites.filter((s) => !needle || (s.nom + " " + (s.adresse || "")).toLowerCase().includes(needle));

  const sections = [];
  if (ranked.length) {
    sections.push({
      title: "5 derniers / suggérés",
      items: ranked.filter((s) => !needle || s.nom.toLowerCase().includes(needle)).slice(0, 5),
    });
  }
  const chantiers = all.filter((s) => s.portee === "chantier" && (!clientId || String(s.client_id) === clientId));
  sections.push({ title: "Chantiers du client", items: chantiers });
  const communs = all.filter((s) => s.portee === "commun");
  sections.push({ title: "Sites communs", items: communs });

  listEl.innerHTML = "";
  let any = false;
  for (const section of sections) {
    if (!section.items.length) continue;
    any = true;
    const titleEl = document.createElement("div");
    titleEl.className = "sheet-section-title";
    titleEl.textContent = section.title;
    listEl.appendChild(titleEl);
    for (const site of section.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-item";
      btn.innerHTML = `${escapeHtml(site.nom)}<span>${escapeHtml(site.adresse || "")}</span>`;
      btn.addEventListener("click", () => {
        if (state.sitePickerTarget) {
          state.sitePickerTarget.value = String(site.id);
          state.sitePickerTarget.dispatchEvent(new Event("change"));
        }
        closeSitePicker();
      });
      listEl.appendChild(btn);
    }
  }
  if (!any) listEl.innerHTML = '<p class="entity-empty">Aucun site trouvé.</p>';
}

/* ========================================================================= Routage == */
const ROUTE_LOADERS = {
  today: loadToday,
  "mes-lv": loadMesLv,
  controle: loadControle,
  dashboard: loadDashboard,
  reglages: loadReglagesBureau,
  lv: loadLvScreen,
  planning: loadPlanning,
  projets: loadProjetsScreen,
  clients: loadClientsScreen,
  sites: loadSitesScreen,
  camions: loadCamionsScreen,
  chauffeurs: loadChauffeursScreen,
  articles: loadArticlesScreen,
  utilisateurs: loadUtilisateursScreen,
};

// Async et retourne la promesse du chargement de route : les appelants qui ont
// besoin d'attendre un rendu complet (ex. les deep-links `?demo=1&screen=...`)
// peuvent faire `await navigate(...)` plutôt que de rappeler le loader en double
// (ce qui créait une course et des doublons de carte de tour en mode démo).
function openNavDrawer() {
  const d = document.getElementById("nav-drawer");
  if (d) d.hidden = false;
}
function closeNavDrawer() {
  const d = document.getElementById("nav-drawer");
  if (d) d.hidden = true;
}

async function navigate(route) {
  if (!ROUTES.includes(route)) route = "dashboard";
  resetUndo(); // on quitte le formulaire courant : la pile d'annulation repart de zéro
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
  document.querySelectorAll(".nav-drawer-list a[data-route]").forEach((a) => {
    a.classList.toggle("is-active", a.dataset.route === route);
  });
  closeNavDrawer();
  try {
    history.replaceState(null, "", "#/" + route);
  } catch (e) {}

  const loader = ROUTE_LOADERS[route];
  if (loader) await loader();
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

  // Tiroir « Plus » (navigation mobile bureau).
  const navMore = document.getElementById("btn-nav-more");
  if (navMore) navMore.addEventListener("click", openNavDrawer);
  const navDrawerClose = document.getElementById("btn-nav-drawer-close");
  if (navDrawerClose) navDrawerClose.addEventListener("click", closeNavDrawer);
  const navDrawer = document.getElementById("nav-drawer");
  if (navDrawer) {
    navDrawer.addEventListener("click", (e) => {
      if (e.target.id === "nav-drawer") closeNavDrawer();
    });
  }

  if (btnUndo) btnUndo.addEventListener("click", undo);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() !== "z") return;
    if (e.shiftKey) return; // pas de « refaire »
    e.preventDefault();
    undo();
  });

  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (r.checked) setTheme(r.value);
    });
  });
  applyTheme(getStoredTheme());

  const btnThemeEl = document.getElementById("btn-theme");
  if (btnThemeEl) btnThemeEl.addEventListener("click", () => {
    const order = ["auto", "clair", "sombre"];
    const next = order[(order.indexOf(getStoredTheme()) + 1) % order.length];
    setTheme(next);
  });

  const navAppSel = document.getElementById("f-nav-app");
  navAppSel.value = getNavApp();
  navAppSel.addEventListener("change", (e) => setNavApp(e.target.value));

  document.getElementById("btn-google-login").addEventListener("click", async () => {
    hideAuthError();
    try {
      await signInWithGoogle();
    } catch (err) {
      showAuthError("Connexion impossible : " + (err && err.message ? err.message : "erreur inconnue"));
    }
  });
  document.getElementById("btn-logout-unauthorized").addEventListener("click", () => signOut());
  document.getElementById("btn-logout").addEventListener("click", () => signOut());

  wireEmailOtpLogin();
  wireReglagesBureauFields();
  initInstall();

  // -------------------------------------------------------- Feuille « choix de site »
  document.getElementById("btn-site-picker-close").addEventListener("click", closeSitePicker);
  document.getElementById("site-picker-sheet").addEventListener("click", (e) => {
    if (e.target.id === "site-picker-sheet") closeSitePicker();
  });
  wireFilterInput(document.getElementById("site-picker-search"), (q) => renderSitePickerList(q));
  document.getElementById("btn-site-picker-new").addEventListener("click", async () => {
    try {
      const site = await createSite({ nom: "Nouveau site", portee: "commun", statut: "actif" });
      state.refs.sites.push(site);
      if (state.sitePickerTarget) {
        state.sitePickerTarget.value = String(site.id);
        state.sitePickerTarget.dispatchEvent(new Event("change"));
      }
      closeSitePicker();
      navigate("sites");
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  });

  // --------------------------------------------------------------- Planning : envoi
  document.getElementById("btn-envoi-groupe").addEventListener("click", async () => {
    const ids = Array.from(state.planningSelection);
    if (!ids.length) return;
    const btn = document.getElementById("btn-envoi-groupe");
    btn.disabled = true;
    try {
      const res = await workerEnvoiGroupe(ids);
      alert(`Envoi déclenché manuellement pour ${res.lv ? res.lv.length : ids.length} LV (Documenso hors périmètre bêta).`);
      state.planningSelection = new Set();
      refreshPlanningSelectionUi();
      await loadPlanning();
    } catch (e) {
      alert("Le service bon-worker n'a pas répondu (jeton IA requis côté serveur) : " + (e.message || e));
      btn.disabled = false;
    }
  });
}

/* =================================================================== Auth : OTP == */
// Connexion par code à 6 chiffres envoyé par e-mail, en alternative à Google.
// Trois étapes dans #screen-login : choix de méthode -> saisie e-mail ->
// saisie du code (avec lien "Renvoyer le code" désactivé 60s). Le succès de
// verifyEmailOtp() déclenche onAuthStateChange comme pour Google : la suite
// (handleSessionChange) n'a rien de spécifique à gérer ici.
let otpResendTimer = null;
let otpEmail = "";

function showLoginStep(step) {
  document.getElementById("login-choice").hidden = step !== "choice";
  document.getElementById("otp-request-form").hidden = step !== "otp-request";
  document.getElementById("otp-verify-form").hidden = step !== "otp-verify";
  hideAuthError();
}

function stopOtpResendCountdown() {
  if (otpResendTimer) {
    clearInterval(otpResendTimer);
    otpResendTimer = null;
  }
}

function startOtpResendCountdown(seconds = 60) {
  const btn = document.getElementById("btn-resend-otp");
  const suffix = document.getElementById("otp-resend-suffix");
  const countdownEl = document.getElementById("otp-resend-countdown");
  let remaining = seconds;
  btn.disabled = true;
  suffix.hidden = false;
  countdownEl.textContent = String(remaining);
  stopOtpResendCountdown();
  otpResendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      stopOtpResendCountdown();
      btn.disabled = false;
      suffix.hidden = true;
    } else {
      countdownEl.textContent = String(remaining);
    }
  }, 1000);
}

function resetEmailOtpLogin() {
  stopOtpResendCountdown();
  otpEmail = "";
  const codeInput = document.getElementById("f-otp-code");
  if (codeInput) codeInput.value = "";
  showLoginStep("choice");
}

function otpErrorMessage(err) {
  const msg = (err && err.message) || "";
  if (!navigator.onLine) {
    return "Connexion réseau indisponible. Vérifiez votre connexion et réessayez.";
  }
  if (/expired|invalid|token/i.test(msg)) {
    return "Code invalide ou expiré. Vérifiez le code reçu ou demandez-en un nouveau.";
  }
  if (/rate limit|too many/i.test(msg)) {
    return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
  }
  return "Une erreur est survenue : " + (msg || "erreur inconnue");
}

function wireEmailOtpLogin() {
  document.getElementById("btn-show-otp").addEventListener("click", () => {
    showLoginStep("otp-request");
    document.getElementById("f-otp-email").focus();
  });

  document.getElementById("btn-back-to-choice").addEventListener("click", () => {
    showLoginStep("choice");
  });

  document.getElementById("btn-change-email").addEventListener("click", () => {
    stopOtpResendCountdown();
    showLoginStep("otp-request");
    document.getElementById("f-otp-email").focus();
  });

  document.getElementById("otp-request-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("f-otp-email");
    const email = emailInput.value.trim();
    if (!email) return;
    const btn = document.getElementById("btn-send-otp");
    hideAuthError();
    btn.disabled = true;
    try {
      await sendEmailOtp(email);
      otpEmail = email;
      document.getElementById("otp-sent-to").textContent = `Code envoyé à ${email}`;
      document.getElementById("f-otp-code").value = "";
      showLoginStep("otp-verify");
      startOtpResendCountdown(60);
      document.getElementById("f-otp-code").focus();
    } catch (err) {
      showAuthError(otpErrorMessage(err));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("otp-verify-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codeInput = document.getElementById("f-otp-code");
    const code = codeInput.value.trim();
    if (!code) return;
    const btn = document.getElementById("btn-verify-otp");
    hideAuthError();
    btn.disabled = true;
    try {
      await verifyEmailOtp(otpEmail, code);
      // onAuthStateChange se déclenche automatiquement (nouvelle session) et
      // pilote la suite via handleSessionChange — rien à faire ici.
    } catch (err) {
      showAuthError(otpErrorMessage(err));
      btn.disabled = false;
    }
  });

  document.getElementById("btn-resend-otp").addEventListener("click", async () => {
    const btn = document.getElementById("btn-resend-otp");
    if (btn.disabled || !otpEmail) return;
    hideAuthError();
    try {
      await sendEmailOtp(otpEmail);
      startOtpResendCountdown(60);
    } catch (err) {
      showAuthError(otpErrorMessage(err));
    }
  });
}

/* ======================================================================== Auth == */
function hideAuthError() {
  const el = document.getElementById("auth-error");
  el.hidden = true;
  el.textContent = "";
}

function showAuthError(message) {
  const el = document.getElementById("auth-error");
  el.hidden = false;
  el.textContent = message;
}

function showScreen(which) {
  document.getElementById("screen-login").hidden = which !== "login";
  document.getElementById("screen-unauthorized").hidden = which !== "unauthorized";
  document.getElementById("app-shell").hidden = which !== "app";
  if (which === "login") resetEmailOtpLogin();
}

function showFatal(message) {
  showScreen("login");
  showAuthError(message);
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
  state.roles = profil
    ? (Array.isArray(profil.roles) && profil.roles.length
        ? profil.roles
        : (profil.role ? [profil.role] : []))
    : [];

  if (!profil) {
    document.getElementById("unauthorized-email").textContent = session.user.email || "";
    showScreen("unauthorized");
    return;
  }

  if (hasRole("chauffeur")) {
    try {
      state.chauffeur = await getChauffeurByEmail(profil.email);
    } catch (err) {
      state.chauffeur = null;
    }
  }

  // Mode démo : `?role=chauffeur|bureau` force le rôle (captures CI des deux layouts).
  if (isDemoMode()) {
    try {
      const forced = new URLSearchParams(location.search).get("role");
      if (forced === "chauffeur") state.roles = ["chauffeur"];
      else if (forced === "bureau") state.roles = ["bureau"];
    } catch (e) { /* noop */ }
  }

  document.body.classList.toggle("has-bureau", hasRole("bureau"));
  document.body.classList.toggle("has-chauffeur", hasRole("chauffeur"));

  const badgeEl = document.getElementById("profil-badge");
  if (badgeEl) badgeEl.textContent = `${profil.nom || profil.email} · ${state.roles.join(" + ") || profil.role}`;
  const initialEl = document.getElementById("profil-initial");
  if (initialEl) initialEl.textContent = (profil.nom || profil.email || "?").trim().charAt(0).toUpperCase();
  const btnProfil = document.getElementById("btn-profil");
  if (btnProfil && !btnProfil.dataset.wired) {
    btnProfil.dataset.wired = "1";
    btnProfil.addEventListener("click", () => navigate("reglages"));
  }
  showScreen("app");

  await loadRefs();
  const navAppSel = document.getElementById("f-nav-app");
  if (navAppSel) navAppSel.value = getNavApp();

  if (isDemoMode() && demoScreenParam()) {
    await openDemoScreen(demoScreenParam());
    return;
  }
  const initialRoute = (window.location.hash || "#/dashboard").replace(/^#\//, "") || "dashboard";
  navigate(initialRoute);
}

// Deep-links `?demo=1&screen=...` (cf. front/README.md et la mission CI
// screenshots). `tour` et `site-picker` ont besoin d'un petit script en plus
// d'un simple changement de route : on attend que "Aujourd'hui" ait fini de
// charger son brouillon de démo avant, respectivement, de laisser le tour
// visible tel quel, ou d'ouvrir la feuille de choix de site par-dessus.
async function openDemoScreen(name) {
  const map = {
    aujourdhui: "today", "mes-lv": "mes-lv", "tableau-de-bord": "dashboard",
    chauffeurs: "chauffeurs", planning: "planning", projets: "projets",
    clients: "clients", sites: "sites", camions: "camions", articles: "articles",
    utilisateurs: "utilisateurs", reglages: "reglages",
  };
  if (name === "tour") {
    await navigate("today");
    return;
  }
  if (name === "site-picker") {
    await navigate("today");
    const firstPicker = document.querySelector("#tours-list .f-site-chargement");
    openSitePicker(firstPicker || document.getElementById("f-camion"));
    return;
  }
  await navigate(map[name] || name);
}

async function boot() {
  wireStaticUI();

  // `?theme=clair|sombre` (uniquement actif sous ?demo=1, cf. demoThemeParam())
  // force le thème pour les captures CI, par-dessus la préférence localStorage.
  if (isDemoMode() && demoThemeParam()) {
    applyTheme(demoThemeParam());
  }

  if (!sb && !isDemoMode()) {
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
