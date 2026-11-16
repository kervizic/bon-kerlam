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
  listPrestations,
  listPrestationsAll,
  listMateriels,
  createPrestation,
  updatePrestation,
  getPrestationsLv,
  createPrestationLigne,
  updatePrestationLigne,
  deletePrestationLigne,
  rpcDernierePrestation,
  rpcDerniereQuantiteEstimee,
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
  workerLvPdf,
  workerSignatureSurPlace,
  workerSignatureParMail,
  searchAddress,
  reverseAddress,
  rpcPrefill,
  rpcSitesPour,
  rpcLvUndo,
  rpcSetDerniereUnite,
  rpcDernieresHeures,
  rpcLvSupprimer,
  rpcLvSupprimerLot,
  rpcLvRestaurer,
  listCorbeille,
  todayIso,
} from "./data.js";

// beta.22 : société -> adresses, fusion réversible, détection de doublons.
import {
  listClientAdresses, createClientAdresse, updateClientAdresse, deleteClientAdresse,
  listSiteSocietes, createSiteSociete, updateSiteSociete,
  rpcFusionnerClients, rpcFusionnerSites, rpcFusionnerSiteSocietes, rpcFusionAnnuler,
  listDoublonsClients, listDoublonsSites, listFusions,
} from "./data.js";

import { initInstall } from "./install.js?v=13";
import { UndoStack } from "./undo-stack.js?v=13";
import { PdfCache, shouldCachePdf, formatGeneratedAt } from "./pdf-cache.js?v=13";
import { statutLabel, lvBadge } from "./status-labels.js?v=21";
import { canGroupForSignature } from "./signature-group.js?v=13";
import { swipeActionsFor, attachSwipe, closeOpenSwipe } from "./swipe-actions.js?v=21";
// pdf-viewer.js (et pdf.js) chargés en import DYNAMIQUE à la 1re ouverture (g).
import { enhanceSelect, refreshCombobox, ensureOption } from "./combobox.js?v=17";
import { initTooltips } from "./tooltips.js?v=22";
import { lvCompleteness, entityMissingFields } from "./completeness.js?v=211";

/* ============================================================== IndexedDB == */
/* Deux object stores :
 *  - "cache" (clé/valeur) : dernier instantané connu (LV du jour) pour l'écran
 *    Contrôle, qui doit pouvoir s'afficher hors-ligne.
 *  - "queue" (autoIncrement) : écritures en attente quand le réseau a coupé en
 *    plein milieu d'une saisie (cf. window.bonSync plus bas).
 */
const DB_NAME = "bon-kerlam";
const DB_VERSION = 2;
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
      // "pdfcache" (clé/valeur) : PDF des lettres non signées du chauffeur, pour
      // l'affichage hors ligne (g). Purgé à la déconnexion.
      if (!db.objectStoreNames.contains("pdfcache")) db.createObjectStore("pdfcache");
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

async function idbKeys(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------------------------------- Cache local des PDF (hors ligne, g) == */
const pdfCache = new PdfCache({
  get: (k) => idbGet("pdfcache", k),
  put: (k, v) => idbSet("pdfcache", k, v),
  delete: (k) => idbDelete("pdfcache", k),
  keys: () => idbKeys("pdfcache"),
});

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
  lv_prestations: updatePrestationLigne,
  prestations: updatePrestation,
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
// Quantités : virgule décimale française affichée (3,5) ET acceptée en saisie.
function frQty(v) {
  return v == null || v === "" ? "" : String(v).replace(".", ",");
}
function parseFrFloat(v) {
  if (v == null) return null;
  const s = String(v).replace(",", ".").trim();
  if (s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
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
  refs: { camions: [], clients: [], projets: [], contacts: [], articles: [], sites: [], chauffeurs: [], prestations: [], materiels: [] },
  prestations: [], // lignes de prestation de la lettre courante
  pendingPrestation: null, // prestation reportée en attente de persistance (nouvelle lettre)
  lv: null,
  tours: [],
  prefillData: {},
  route: "dashboard",
  mode: "chauffeur", // vue active : "chauffeur" (défaut) | "bureau"
  reglages: {},
  planningSelection: new Set(),
  sitePickerTarget: null, // <select> actuellement ciblé par la feuille de choix de site
};

const ROUTES = [
  "dashboard", "today", "mes-lv", "reglages",
  "lv", "planning", "projets", "clients", "sites", "camions",
  "chauffeurs", "articles", "prestations", "utilisateurs",
];

function hasRole(role) {
  return state.roles.includes(role);
}

/* ------------------------------------------------- Vue Chauffeur | Bureau (d) ==
 * Le mode pilote la navigation (barre d'onglets, menu latéral, tiroir « Plus »).
 * Défaut « chauffeur » pour TOUS les utilisateurs au premier lancement ; dernier
 * mode mémorisé sur l'appareil (localStorage). Le sélecteur n'est visible que
 * pour les rôles bureau et ne donne AUCUN droit (la RLS reste la seule autorité).
 */
const VIEW_MODE_KEY = "bon_view_mode";
const CHAUFFEUR_ROUTES = ["today", "mes-lv"]; // reglages est commun aux deux modes

function canSwitchMode() {
  return hasRole("bureau");
}
function getStoredMode() {
  try {
    const m = localStorage.getItem(VIEW_MODE_KEY);
    if (m === "bureau" || m === "chauffeur") return m;
  } catch (e) { /* localStorage indisponible : on retombe sur le défaut */ }
  return "chauffeur";
}
function persistMode(mode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch (e) { /* noop */ }
}
function defaultRouteForMode(mode = state.mode) {
  // Accueil chauffeur (f) = liste des lettres non signées ; bureau = tableau.
  return mode === "bureau" ? "dashboard" : "mes-lv";
}
function applyModeUi() {
  const mode = state.mode;
  document.body.classList.toggle("mode-chauffeur", mode === "chauffeur");
  document.body.classList.toggle("mode-bureau", mode === "bureau");
  document.querySelectorAll(".mode-seg").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false");
  });
}
function setMode(mode, { navigateDefault = true } = {}) {
  if (!canSwitchMode()) mode = "chauffeur";
  if (mode !== "chauffeur" && mode !== "bureau") mode = "chauffeur";
  const changed = state.mode !== mode;
  state.mode = mode;
  persistMode(mode);
  applyModeUi();
  if (changed) resetUndo(); // pile d'annulation remise à zéro au changement de mode
  if (navigateDefault) navigate(defaultRouteForMode(mode));
}
function initModeForUser() {
  const canSwitch = canSwitchMode();
  document.body.classList.toggle("can-switch-mode", canSwitch);
  const switchHeader = document.getElementById("mode-switch-header");
  const switchDrawer = document.getElementById("mode-switch-drawer");
  if (switchHeader) switchHeader.hidden = !canSwitch;
  if (switchDrawer) switchDrawer.hidden = !canSwitch;
  state.mode = canSwitch ? getStoredMode() : "chauffeur";
  applyModeUi();
}
// Bascule le mode pour qu'il corresponde à la route demandée (cohérence nav).
function maybeSwitchModeForRoute(route) {
  if (!canSwitchMode() || route === "reglages") return;
  const wanted = CHAUFFEUR_ROUTES.includes(route) ? "chauffeur" : "bureau";
  if (state.mode !== wanted) setMode(wanted, { navigateDefault: false });
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

// Filtre « À compléter » des écrans bureau (beta.20) : état de la case + re-rendu.
function incompleteChecked(checkboxId) {
  const el = document.getElementById(checkboxId);
  return !!(el && el.checked);
}
function wireIncompleteToggle(checkboxId, filterInputId, render) {
  const box = document.getElementById(checkboxId);
  if (!box || box._wired) return;
  box._wired = true;
  box.addEventListener("change", () => {
    const input = document.getElementById(filterInputId);
    render(input ? input.value.trim().toLowerCase() : "");
  });
}
// Pastille rouge « À compléter » sur une fiche aux champs obligatoires manquants.
function incompletePill(kind, row) {
  const miss = entityMissingFields(kind, row);
  return miss.length
    ? `<span class="status-pill status-expired" title="Manque : ${escapeHtml(miss.join(", "))}">À compléter</span>`
    : "";
}

function fieldBlock(labelText, inputEl, ttKey) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  if (ttKey) label.dataset.tt = ttKey;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function makeTextInput(type, value, attrs = {}) {
  const el = document.createElement("input");
  el.type = type;
  if (value != null) el.value = value;
  // Attributs clavier / autofill iOS (e-mail, tél, nom…) passés par la fiche rapide.
  if (attrs.inputmode) el.setAttribute("inputmode", attrs.inputmode);
  if (attrs.autocomplete) el.setAttribute("autocomplete", attrs.autocomplete);
  if (attrs.autocapitalize) el.setAttribute("autocapitalize", attrs.autocapitalize);
  if (attrs.name) el.setAttribute("name", attrs.name);
  if (attrs.placeholder) el.setAttribute("placeholder", attrs.placeholder);
  return el;
}

function makeSelectInput(options, value, placeholder = "Choisir…") {
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
function plur(n, singulier, pluriel) {
  return `${n} ${Number(n) > 1 ? pluriel : singulier}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function populateSelect(selectEl, items, getValue, getLabel, placeholder = "Choisir…", getAlias = null) {
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = String(getValue(item));
    opt.textContent = getLabel(item);
    if (getAlias) {
      const a = getAlias(item);
      if (a) opt.dataset.alias = a;
    }
    selectEl.appendChild(opt);
  }
  if (current) selectEl.value = current;
  refreshCombobox(selectEl);
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
  const [camions, clients, projets, contacts, articles, sites, chauffeurs, prestations, materiels, reglages, siteSocietes] = await Promise.all([
    listCamions().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listClients().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listProjets().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listContacts().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listArticles().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listSites().catch((e) => { reportIfVersionMismatch(e); return []; }),
    listChauffeurs().catch(() => []),
    listPrestations().catch(() => []),
    listMateriels().catch(() => []),
    listReglages().catch(() => []),
    listSiteSocietes().catch(() => []),
  ]);
  state.refs = { camions, clients, projets, contacts, articles, sites, chauffeurs, prestations, materiels, siteSocietes };
  state.reglages = Object.fromEntries(reglages.map((r) => [r.cle, r.valeur]));
  populateSelect(document.getElementById("f-camion"), camions, (c) => c.id, (c) => c.immatriculation);
  populateSelect(document.getElementById("f-client"), clients, (c) => c.id, (c) => c.raison_sociale, "Choisir ou taper…", (c) => c.alias);
  populateSelect(document.getElementById("f-dest-client"), clients, (c) => c.id, (c) => c.raison_sociale, "Choisir ou taper…", (c) => c.alias);
  refreshProjetContactOptions();
  enhanceHeaderComboboxes();
}

/* ======================================================= Comboboxes (beta.17) ==
 * Champs de recherche (façon Odoo) greffés sur les <select> de l'en-tête. Le
 * <select> reste la source de vérité (value + change + autosave). La dernière
 * ligne « + Créer » ouvre la fiche rapide (bottom sheet). Récents par chauffeur.
 */
let headerComboboxesReady = false;
function driverIdForRecents() {
  return state.chauffeur ? state.chauffeur.id : (state.profil ? state.profil.email : null);
}
function enhanceHeaderComboboxes() {
  if (headerComboboxesReady) {
    ["f-camion", "f-client", "f-projet", "f-contact", "f-dest-client"].forEach((idf) =>
      refreshCombobox(document.getElementById(idf))
    );
    return;
  }
  headerComboboxesReady = true;
  const di = driverIdForRecents;
  enhanceSelect(document.getElementById("f-camion"), {
    entity: "camion", driverId: di, placeholder: "Choisir ou taper…",
  });
  enhanceSelect(document.getElementById("f-client"), {
    entity: "client", driverId: di, placeholder: "Choisir ou taper…",
    createLabel: "un client",
    onCreate: (text) => openQuickCreate("client", text),
    onEdit: (value) => openQuickCreate("client", "", value),
    canEdit: () => true,
  });
  enhanceSelect(document.getElementById("f-projet"), {
    entity: "projet", driverId: di, placeholder: "Facultatif — choisir ou taper…",
    createLabel: "un projet",
    onCreate: (text) => openQuickCreate("projet", text),
    onEdit: (value) => openQuickCreate("projet", "", value),
    canEdit: () => true,
  });
  enhanceSelect(document.getElementById("f-contact"), {
    entity: "contact", driverId: di, placeholder: "Choisir ou taper…",
    createLabel: "un contact signataire",
    onCreate: (text) => openQuickCreate("contact", text),
    onEdit: (value) => openQuickCreate("contact", "", value),
    canEdit: () => true,
  });
  // Destinataire (D) : même combobox que Client (recherche sociétés + alias,
  // création avec adresse, crayon d'édition). L'adresse du destinataire est une
  // mention obligatoire (arrêté du 9/11/1999 art. 5) -> imprimée sur le PDF.
  enhanceSelect(document.getElementById("f-dest-client"), {
    entity: "client", driverId: di, placeholder: "Choisir ou taper…",
    createLabel: "un destinataire",
    onCreate: (text) => openQuickCreate("client", text),
    onEdit: (value) => openQuickCreate("client", "", value),
    canEdit: () => true,
  });
}

/* ------------------------------------------------- Fiche rapide (bottom sheet) ==
 * Création / modification express d'un référentiel, par-dessus le formulaire.
 * Appelée par la dernière ligne « + Créer » d'un combobox, ou par le crayon.
 * Renvoie une promesse résolue avec { value, label, alias } après création (pour
 * que le combobox sélectionne la fiche), ou null si annulée. */
const QC_SPECS = {
  client: {
    title: "client",
    fields: [
      { key: "raison_sociale", label: "Nom / raison sociale", required: true, fromText: true, reqMsg: "Nom manquant",
        autocomplete: "organization", autocapitalize: "words" },
      { key: "adresse", label: "Adresse, CP et ville (imprimée sur la lettre)", required: true, reqMsg: "Adresse manquante",
        autocomplete: "street-address", autocapitalize: "words" },
      { key: "siren", label: "SIREN (facultatif)", inputmode: "numeric", autocomplete: "off", tt: "qc_siren" },
    ],
    create: (v) => createClient({ raison_sociale: v.raison_sociale, adresse: v.adresse || null, siren: v.siren || null, actif: true }),
    update: (id, v) => updateClient(id, { raison_sociale: v.raison_sociale, adresse: v.adresse || null, siren: v.siren || null }),
    store: "clients",
    toItem: (r) => ({ value: r.id, label: r.raison_sociale, alias: r.alias || "" }),
    fill: (r) => ({ raison_sociale: r.raison_sociale, adresse: r.adresse, siren: r.siren }),
  },
  projet: {
    title: "projet",
    needsClient: true,
    fields: [{ key: "nom", label: "Nom du projet", required: true, fromText: true, reqMsg: "Nom manquant" }],
    create: (v) => createProjet({ client_id: v._client_id, nom: v.nom }),
    update: (id, v) => updateProjet(id, { nom: v.nom }),
    store: "projets",
    toItem: (r) => ({ value: r.id, label: r.nom || `Projet #${r.id}`, alias: "" }),
    fill: (r) => ({ nom: r.nom }),
  },
  contact: {
    title: "contact signataire",
    needsClient: true,
    fields: [
      { key: "nom", label: "Nom", required: true, fromText: true, reqMsg: "Nom manquant",
        autocomplete: "name", autocapitalize: "words" },
      { key: "email", label: "E-mail (obligatoire)", type: "email", required: true, email: true, reqMsg: "E-mail manquant",
        inputmode: "email", autocomplete: "email", autocapitalize: "off", tt: "qc_contact_email" },
      { key: "tel", label: "Téléphone (facultatif)", type: "tel",
        inputmode: "tel", autocomplete: "tel" },
    ],
    create: (v) => createContact({ client_id: v._client_id, nom: v.nom, email: v.email, tel: v.tel || null, signataire: false }),
    update: (id, v) => updateContact(id, { nom: v.nom, email: v.email, tel: v.tel || null }),
    store: "contacts",
    toItem: (r) => ({ value: r.id, label: r.nom, alias: "" }),
    fill: (r) => ({ nom: r.nom, email: r.email, tel: r.tel }),
  },
  site: {
    title: "site",
    fields: [
      { key: "nom", label: "Nom du site", required: true, fromText: true, autocapitalize: "words", reqMsg: "Nom manquant" },
      { key: "adresse", label: "Adresse, CP et ville", required: true, reqMsg: "Adresse manquante",
        autocomplete: "street-address", autocapitalize: "words" },
    ],
    create: (v) => {
      const clientId = toIntOrNull(document.getElementById("f-client").value);
      // Un chauffeur ne peut créer qu'un chantier (rattaché au client). Avec un
      // client choisi -> chantier ; sinon site commun (réservé au bureau côté RLS).
      const chantier = clientId != null;
      return createSite({
        nom: v.nom, adresse: v.adresse || null, statut: "actif",
        portee: chantier ? "chantier" : "commun",
        client_id: chantier ? clientId : null,
      });
    },
    update: (id, v) => updateSite(id, { nom: v.nom, adresse: v.adresse || null }),
    store: "sites",
    toItem: (r) => ({ value: r.id, label: r.nom, alias: "" }),
    fill: (r) => ({ nom: r.nom, adresse: r.adresse }),
  },
  article: {
    title: "article",
    fields: [{ key: "nom", label: "Nom de l'article", required: true, fromText: true, reqMsg: "Nom manquant" }],
    create: (v) => createArticle({ nom: v.nom, actif: true }),
    update: (id, v) => updateArticle(id, { nom: v.nom }),
    store: "articles",
    toItem: (r) => ({ value: r.id, label: r.nom, alias: "" }),
    fill: (r) => ({ nom: r.nom }),
  },
};

// Fiche rapide SANS bouton « Enregistrer » (beta.20) : enregistrement en temps réel.
// La fiche est créée dès que le champ primaire (1er, obligatoire) reçoit une saisie,
// puis chaque champ s'enregistre en direct (indicateur « Enregistré »). Les champs
// obligatoires manquants passent en rouge (message court sous le champ), sans jamais
// bloquer : on peut fermer une fiche incomplète (elle reste enregistrée telle quelle).
let qcResolve = null;
let qcState = null;         // { entity, spec, id, created, inputs, needsClient, lastItem, saving }
let qcSaveChain = Promise.resolve();
const qcDebounce = { t: null };

function qcSetStatus(txt) {
  const el = document.getElementById("quick-create-status");
  if (!el) return;
  if (!txt) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = txt;
  el.hidden = false;
}

function qcFieldErrorEl(input) {
  let p = input.parentElement.querySelector(".field-error-inline");
  if (!p) {
    p = document.createElement("p");
    p.className = "field-error-inline";
    p.setAttribute("aria-live", "polite");
    input.parentElement.appendChild(p);
  }
  return p;
}

function qcValidateField(f, input) {
  const val = (input.value || "").trim();
  let msg = "";
  if (f.required && !val) msg = f.reqMsg || `${f.label} manquant`;
  else if (f.email && val && !isValidEmail(val)) msg = "E-mail invalide";
  const p = qcFieldErrorEl(input);
  if (msg) { input.classList.add("field-invalid"); p.textContent = msg; p.hidden = false; } else { input.classList.remove("field-invalid"); p.textContent = ""; p.hidden = true; }
  return !msg;
}

function qcGatherValues(st) {
  const values = {};
  for (const f of st.spec.fields) values[f.key] = (st.inputs[f.key].value || "").trim();
  if (st.needsClient) values._client_id = toIntOrNull(document.getElementById("f-client").value);
  return values;
}

async function qcDoSave(st) {
  if (!st || qcState !== st) return;
  const values = qcGatherValues(st);
  const primaryKey = st.spec.fields[0].key;
  // Création impossible tant que le champ primaire (NOT NULL) est vide, ou qu'un
  // client est requis mais absent : on attend la prochaine saisie.
  if (!st.created && !values[primaryKey]) { qcSetStatus(""); return; }
  if (st.needsClient && values._client_id == null) { qcSetStatus(""); return; }
  qcSetStatus("Enregistrement…");
  try {
    let row;
    if (!st.created) {
      row = await st.spec.create(values);
      st.id = row.id;
      st.created = true;
      (state.refs[st.spec.store] = state.refs[st.spec.store] || []).push(row);
      if (st.entity === "projet" || st.entity === "contact") refreshProjetContactOptions();
    } else {
      row = await st.spec.update(st.id, values);
      if (!row) row = Object.assign({ id: st.id }, values);
      const arr = state.refs[st.spec.store] || [];
      const i = arr.findIndex((r) => String(r.id) === String(st.id));
      if (i >= 0) arr[i] = Object.assign({}, arr[i], row); else arr.push(row);
    }
    st.lastItem = st.spec.toItem(row);
    qcSetStatus("Enregistré");
  } catch (err) {
    console.error("[app] fiche rapide : enregistrement en échec", err);
    qcSetStatus("Non enregistré");
  }
}

// Enfile un enregistrement (sérialisé : jamais deux create/update en parallèle).
function qcQueueSave() {
  const st = qcState;
  if (!st) return qcSaveChain;
  qcSaveChain = qcSaveChain.then(() => qcDoSave(st)).catch(() => {});
  return qcSaveChain;
}

function qcOnInput(f) {
  const st = qcState;
  if (!st) return;
  const input = st.inputs[f.key];
  if (!input || input.disabled) return;
  qcValidateField(f, input);
  clearTimeout(qcDebounce.t);
  qcSetStatus("Enregistrement…");
  qcDebounce.t = setTimeout(() => qcQueueSave(), 450);
}

function openQuickCreate(entity, prefillText = "", editValue = null) {
  const spec = QC_SPECS[entity];
  if (!spec) return Promise.resolve(null);
  const sheet = document.getElementById("quick-create-sheet");
  const body = document.getElementById("quick-create-body");
  const titleEl = document.getElementById("quick-create-title");
  const editing = editValue != null;

  // projet/contact : besoin d'un client choisi. Non bloquant par une alerte :
  // on l'indique dans la fiche et on désactive la saisie tant qu'il manque.
  const clientMissing = spec.needsClient && !editing && !document.getElementById("f-client").value;

  const existing = editing
    ? (state.refs[spec.store] || []).find((r) => String(r.id) === String(editValue))
    : null;
  const preset = existing ? spec.fill(existing) : {};

  titleEl.textContent = (editing ? "Modifier le " : "Nouveau ") + spec.title;
  body.innerHTML = "";
  qcSetStatus("");

  const inputs = {};
  qcState = {
    entity, spec, id: existing ? existing.id : null, created: !!existing,
    inputs, needsClient: !!spec.needsClient, lastItem: existing ? spec.toItem(existing) : null,
  };

  for (const f of spec.fields) {
    const input = makeTextInput(
      f.type || "text",
      preset[f.key] != null ? preset[f.key] : (f.fromText ? prefillText : ""),
      { inputmode: f.inputmode, autocomplete: f.autocomplete, autocapitalize: f.autocapitalize, name: f.key },
    );
    input.required = !!f.required;
    if (clientMissing) input.disabled = true;
    inputs[f.key] = input;
    body.appendChild(fieldBlock(f.label, input, f.tt));
    input.addEventListener("input", () => qcOnInput(f));
    input.addEventListener("change", () => qcOnInput(f));
    input.addEventListener("blur", () => qcValidateField(f, input));
  }

  if (clientMissing) {
    const warn = document.createElement("p");
    warn.className = "field-error-inline qc-banner-warn";
    warn.hidden = false;
    warn.textContent = "Choisissez d'abord un client sur la lettre.";
    body.prepend(warn);
  }

  sheet.hidden = false;
  initTooltips(body);
  // Ajuste la fiche plein écran à visualViewport (clavier iOS) + verrou de défilement.
  attachQuickCreateViewport(sheet);
  // Garder le champ actif visible quand le clavier le pousse hors écran.
  if (!body._qcFocusWired) {
    body._qcFocusWired = true;
    body.addEventListener("focusin", (e) => {
      if (e.target && e.target.scrollIntoView) {
        setTimeout(() => { try { e.target.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (err) { /* noop */ } }, 120);
      }
    });
  }
  // Si prérempli (texte tapé dans le combobox) : enregistre d'emblée la fiche.
  if (!editing && !clientMissing && (preset[spec.fields[0].key] || prefillText)) qcQueueSave();
  // Édition d'une fiche incomplète : marque les obligatoires manquants en rouge.
  if (editing) for (const f of spec.fields) qcValidateField(f, inputs[f.key]);

  const first = inputs[spec.fields[0].key];
  setTimeout(() => { try { first.focus(); } catch (e) { /* noop */ } }, 50);

  return new Promise((resolve) => {
    qcResolve = resolve;
    sheet._qcCleanup = () => { detachQuickCreateViewport(sheet); };
  });
}

async function closeQuickCreate() {
  const sheet = document.getElementById("quick-create-sheet");
  if (!sheet || sheet.hidden) return;
  const st = qcState;
  // Vide toute saisie en attente (debounce) puis attend la fin des enregistrements :
  // une fiche incomplète reste enregistrée telle quelle, aucun dialogue « Abandonner ? ».
  clearTimeout(qcDebounce.t);
  qcQueueSave();
  try { await qcSaveChain; } catch (e) { /* noop */ }
  sheet.hidden = true;
  if (sheet._qcCleanup) sheet._qcCleanup();
  detachQuickCreateViewport(sheet);
  const item = st && st.lastItem ? st.lastItem : null;
  qcState = null;
  if (qcResolve) { qcResolve(item); qcResolve = null; }
}

// Format e-mail (validation légère côté client ; GoTrue/API restent la vérité).
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

/* Ajuste la feuille fiche rapide au visualViewport : quand le clavier iOS s'ouvre,
 * visualViewport rétrécit. On borne l'overlay à la zone VISIBLE (hauteur + offset)
 * pour que le panneau (ancré en bas) et son bouton « Enregistrer » restent au-dessus
 * du clavier et de la barre d'accessoires. Sans visualViewport : no-op (la feuille
 * garde son max-height 85vh). */
let _qcScrollY = 0;

function attachQuickCreateViewport(sheet) {
  // Verrou de défilement de la PAGE : mémorise la position puis fige le body, pour
  // qu'iOS ne fasse plus défiler la lettre derrière la fiche au focus d'un champ.
  _qcScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = `-${_qcScrollY}px`;
  document.body.classList.add("qc-lock");

  const vv = window.visualViewport;
  const apply = () => {
    // La fiche occupe EXACTEMENT la fenêtre visuelle (sous la barre d'état, au-dessus
    // du clavier) : top = offsetTop, height = height, suivis sur resize/scroll.
    sheet.style.position = "fixed";
    sheet.style.left = "0";
    sheet.style.width = "100%";
    sheet.style.bottom = "auto";
    if (vv) {
      sheet.style.top = vv.offsetTop + "px";
      sheet.style.height = vv.height + "px";
    } else {
      sheet.style.top = "0";
      sheet.style.height = "100%";
    }
  };
  apply();
  sheet._qcVvApply = apply;
  if (vv) {
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
  }
}

function detachQuickCreateViewport(sheet) {
  const vv = window.visualViewport;
  if (vv && sheet._qcVvApply) {
    vv.removeEventListener("resize", sheet._qcVvApply);
    vv.removeEventListener("scroll", sheet._qcVvApply);
  }
  sheet._qcVvApply = null;
  // Réinitialise les styles inline posés par apply().
  for (const p of ["position", "left", "width", "top", "height", "bottom"]) sheet.style[p] = "";
  // Libère le verrou de défilement et restaure la position de la page (idempotent).
  if (document.body.classList.contains("qc-lock")) {
    document.body.classList.remove("qc-lock");
    document.body.style.top = "";
    window.scrollTo(0, _qcScrollY);
  }
}

function refreshProjetContactOptions() {
  const clientId = document.getElementById("f-client").value;
  const projets = clientId ? state.refs.projets.filter((p) => String(p.client_id) === clientId) : state.refs.projets;
  const contacts = clientId ? state.refs.contacts.filter((c) => String(c.client_id) === clientId) : state.refs.contacts;
  populateSelect(document.getElementById("f-projet"), projets, (p) => p.id, (p) => p.nom || p.ref_contrat || `Projet #${p.id}`, "Facultatif — choisir ou taper…");
  populateSelect(document.getElementById("f-contact"), contacts, (c) => c.id, (c) => c.nom, "Choisir ou taper…");
}

// Changement de client : on refiltre Projet/Contact et on purge les valeurs qui
// n'appartiennent plus au client choisi (sinon on enverrait un projet d'un autre
// client). Les purges sont persistées via l'événement change du <select>.
function onClientChange() {
  const clientId = document.getElementById("f-client").value;
  const projetSel = document.getElementById("f-projet");
  const contactSel = document.getElementById("f-contact");
  const prevProjet = projetSel.value;
  const prevContact = contactSel.value;
  if (clientId) {
    const projet = state.refs.projets.find((p) => String(p.id) === projetSel.value);
    if (projet && String(projet.client_id) !== clientId) projetSel.value = "";
    const contact = state.refs.contacts.find((c) => String(c.id) === contactSel.value);
    if (contact && String(contact.client_id) !== clientId) contactSel.value = "";
  }
  refreshProjetContactOptions();
  if (projetSel.value !== prevProjet) projetSel.dispatchEvent(new Event("change", { bubbles: true }));
  if (contactSel.value !== prevContact) contactSel.dispatchEvent(new Event("change", { bubbles: true }));
  refreshAdressePicker({ selectId: "f-client-adresse", wrapId: "field-client-adresse-wrap",
    clientId: toIntOrNull(clientId), saveField: "client_adresse_id" });
}

// beta.22 : libellé d'une adresse de société (sans tiret cadratin).
function adresseLabel(a) {
  const lib = (a.libelle || "").trim();
  const adr = (a.adresse || "").trim();
  if (lib && adr) return `${lib} · ${adr}`;
  return adr || lib || `Adresse #${a.id}`;
}

// Affiche le sélecteur d'adresse si la société a plusieurs adresses ; sinon
// l'unique adresse est prise d'office (décision A). Persiste le choix sur la LV.
async function refreshAdressePicker({ selectId, wrapId, clientId, saveField, selectedId = null }) {
  const sel = document.getElementById(selectId);
  const wrap = document.getElementById(wrapId);
  if (!sel || !wrap) return;
  if (!clientId) {
    wrap.hidden = true;
    sel.innerHTML = '<option value="">Choisir…</option>';
    return;
  }
  let adresses = [];
  try { adresses = await listClientAdresses(clientId); } catch (err) { adresses = []; }
  if (adresses.length <= 1) {
    wrap.hidden = true;
    const only = adresses[0] ? adresses[0].id : null;
    if (state.lv) { try { await updateLv(state.lv.id, { [saveField]: only }); } catch (err) { /* ignore */ } }
    return;
  }
  populateSelect(sel, adresses, (a) => a.id, (a) => adresseLabel(a), "Choisir…");
  let val = selectedId != null ? String(selectedId) : "";
  if (!val) {
    const p = adresses.find((a) => a.is_principale) || adresses[0];
    val = p ? String(p.id) : "";
  }
  sel.value = val;
  wrap.hidden = false;
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
    <div class="dash-tile"><strong>${lvToday.length}</strong><span>Lettres de voiture aujourd'hui</span></div>
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

  // Client référencé directement sur la lettre (beta.17). Repli : client du
  // projet pour les lettres antérieures qui n'ont pas de client_id.
  let clientId = d.client_id != null ? d.client_id : null;
  if (clientId == null && d.projet_id != null) {
    const projet = state.refs.projets.find((p) => p.id === d.projet_id);
    clientId = projet ? projet.client_id : null;
  }
  document.getElementById("f-client").value = clientId != null ? String(clientId) : "";
  refreshProjetContactOptions();

  document.getElementById("f-projet").value = d.projet_id != null ? String(d.projet_id) : "";
  document.getElementById("f-contact").value = d.contact_id != null ? String(d.contact_id) : "";
  ["f-client", "f-projet", "f-contact", "f-camion"].forEach((idf) => refreshCombobox(document.getElementById(idf)));
  refreshAdressePicker({ selectId: "f-client-adresse", wrapId: "field-client-adresse-wrap",
    clientId, saveField: "client_adresse_id", selectedId: d.client_adresse_id });

  fillDestinataireControls(d);
  renderCreneaux(Array.isArray(d.heures) ? d.heures : []);

  // Quantité estimée de la journée (beta.20) : nombre + unité.
  const qEl = document.getElementById("f-qte-estimee");
  const qUEl = document.getElementById("f-qte-estimee-unite");
  if (qEl) qEl.value = d.quantite_estimee != null ? String(d.quantite_estimee) : "";
  if (qUEl) qUEl.value = d.quantite_estimee_unite || "";
}

/* -------------------------------------------------- Heures en créneaux (beta.15) ==
 * Liste de créneaux (début + fin, sélecteur d'heure natif 24 h). « + Ajouter un
 * créneau » ajoute une ligne, la croix la supprime. Si fin < début, c'est une
 * astreinte (passage au lendemain) acceptée sans message. Les créneaux sont
 * stockés en jsonb sur la lettre (colonne heures, cf. migration 0017). Une
 * nouvelle lettre reprend les créneaux de la dernière lettre du chauffeur. */
// beta.22 (E3) : <input type="time"> n'accepte que HH:MM. Postgres peut renvoyer
// « 08:00:00 » (type time avec secondes) : on tronque pour un affichage HH:MM.
function hhmm(v) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, 5) : "";
}

function makeCreneauRow(cr) {
  const tpl = document.getElementById("tpl-creneau");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector(".f-creneau-debut").value = hhmm(cr && cr.debut);
  node.querySelector(".f-creneau-fin").value = hhmm(cr && cr.fin);
  node.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("change", saveCreneaux);
  });
  node.querySelector(".btn-delete-creneau").addEventListener("click", () => {
    node.remove();
    saveCreneaux();
  });
  return node;
}

function renderCreneaux(creneaux) {
  const listEl = document.getElementById("creneaux-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const rows = (creneaux && creneaux.length) ? creneaux : [{ debut: "", fin: "" }];
  for (const cr of rows) listEl.appendChild(makeCreneauRow(cr));
}

// Lit les créneaux saisis (une ligne retenue dès qu'une heure de début est posée).
function collectCreneaux() {
  const out = [];
  document.querySelectorAll("#creneaux-list .creneau-row").forEach((row) => {
    const debut = row.querySelector(".f-creneau-debut").value || "";
    const fin = row.querySelector(".f-creneau-fin").value || "";
    if (debut || fin) out.push({ debut, fin });
  });
  return out;
}

let creneauxSaveTimer = null;
function saveCreneaux() {
  if (creneauxSaveTimer) clearTimeout(creneauxSaveTimer);
  setSyncState("sending");
  creneauxSaveTimer = setTimeout(async () => {
    creneauxSaveTimer = null;
    const heures = collectCreneaux();
    try {
      // Pas de lettre et aucun créneau saisi : rien à persister (pas de brouillon vide).
      if (!state.lv && !heures.length) {
        setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
        return;
      }
      const lvId = await ensureLv();
      await patchRemote("lettres_voiture", lvId, { heures: heures.length ? heures : null });
      if (state.lv) state.lv.heures = heures.length ? heures : null;
      setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
    } catch (err) {
      console.error("[app] saveCreneaux en échec", err);
      setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
    }
  }, 600);
}

function addCreneau() {
  const listEl = document.getElementById("creneaux-list");
  if (listEl) listEl.appendChild(makeCreneauRow({ debut: "", fin: "" }));
}

// Destinataire (D) : « Identique au client » (défaut) OU un destinataire distinct
// choisi dans le même combobox que Client (sociétés + alias, création avec adresse,
// crayon d'édition). Si un destinataire est choisi, son nom ET son adresse sont
// imprimés sur le PDF (mention obligatoire — arrêté du 9/11/1999 art. 5), via la
// clé destinataire_client_id. Les lettres anciennes (destinataire en texte libre,
// sans adresse) sont conservées EN LECTURE seule (migration douce) et ne sont
// jamais réécrites tant que l'utilisateur ne change rien.
function fillDestinataireControls(d) {
  const mode = document.getElementById("f-dest-mode");
  const destClient = document.getElementById("f-dest-client");
  const legacy = document.getElementById("f-dest-legacy");
  legacy.value = "";
  if (d.dest_identique !== false) {
    mode.value = "identique"; destClient.value = "";
  } else {
    mode.value = "autre_client";
    // 1) clé explicite ; 2) repli : texte destinataire correspondant à un client ;
    // 3) ancienne saisie libre sans correspondance -> affichée en lecture seule.
    const byId = d.destinataire_client_id != null
      ? (state.refs.clients || []).find((c) => String(c.id) === String(d.destinataire_client_id))
      : null;
    const byName = !byId
      ? (state.refs.clients || []).find((c) => c.raison_sociale === d.destinataire)
      : null;
    const match = byId || byName;
    if (match) { destClient.value = String(match.id); }
    else { destClient.value = ""; legacy.value = d.destinataire || ""; }
  }
  refreshCombobox(destClient);
  updateDestVisibility();
  refreshAdressePicker({ selectId: "f-dest-adresse", wrapId: "field-dest-adresse-wrap",
    clientId: d.dest_identique !== false ? null : toIntOrNull(destClient.value),
    saveField: "dest_adresse_id", selectedId: d.dest_adresse_id });
}

function updateDestVisibility() {
  const mode = document.getElementById("f-dest-mode").value;
  const destClient = document.getElementById("f-dest-client");
  const legacy = document.getElementById("f-dest-legacy");
  document.getElementById("field-dest-client-wrap").hidden = mode !== "autre_client";
  // Ancienne saisie libre : visible seulement si présente et sans client choisi.
  const showLegacy = mode === "autre_client" && !destClient.value && !!legacy.value;
  document.getElementById("field-dest-legacy-wrap").hidden = !showLegacy;
  if (mode !== "autre_client") document.getElementById("field-dest-adresse-wrap").hidden = true;
}

async function saveDestinataire() {
  updateDestVisibility();
  const mode = document.getElementById("f-dest-mode").value;
  const destIdentique = mode === "identique";
  const legacy = document.getElementById("f-dest-legacy");
  let destinataire = null;
  let destinataire_client_id = null;
  if (mode === "autre_client") {
    const c = (state.refs.clients || []).find((x) => String(x.id) === document.getElementById("f-dest-client").value);
    if (c) {
      destinataire_client_id = c.id;
      destinataire = c.raison_sociale; // conservé pour la recherche / compat lecture
    } else if (legacy.value) {
      // Lettre ancienne non convertie : on ne détruit pas la saisie libre.
      destinataire = legacy.value;
    }
  }
  setSyncState("sending");
  try {
    const lvId = await ensureLv();
    await patchRemote("lettres_voiture", lvId, { dest_identique: destIdentique, destinataire, destinataire_client_id });
    if (state.lv) {
      state.lv.dest_identique = destIdentique;
      state.lv.destinataire = destinataire;
      state.lv.destinataire_client_id = destinataire_client_id;
    }
    refreshAdressePicker({ selectId: "f-dest-adresse", wrapId: "field-dest-adresse-wrap",
      clientId: destinataire_client_id, saveField: "dest_adresse_id" });
    setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
  } catch (err) {
    console.error(err);
    setSyncState(window.bonSync.queueLength > 0 ? "offline" : "saved");
  }
}

function renderLvNumero() {
  const el = document.getElementById("lv-numero");
  const numero = state.lv && state.lv.numero;
  if (numero) {
    el.textContent = numero;             // KER-xxxxx, police système
    el.classList.remove("is-brouillon");
  } else {
    // Pas de numéro tant qu'aucun tour : discret « Brouillon » (jamais « — »).
    el.textContent = "Brouillon";
    el.classList.add("is-brouillon");
  }
  refreshDeleteButton();
}

/* ============================================= Suppression / annulation (beta.15) ==
 * Lettre NON signée uniquement. Brouillon sans numéro -> corbeille (restaurable
 * 30 jours). Lettre numérotée -> statut « Annulée » + motif court, numéro
 * conservé, masquée des listes. Lettre signée -> jamais supprimable (bouton
 * caché, refus serveur). La RLS limite déjà le chauffeur à ses propres lettres. */
function refreshDeleteButton() {
  const btn = document.getElementById("btn-delete-lv");
  if (!btn) return;
  const lv = state.lv;
  btn.hidden = !(lv && lv.id != null && lv.statut !== "signee");
}

function openDeleteSheet() {
  const lv = state.lv;
  if (!lv || lv.id == null || lv.statut === "signee") return;
  const isBrouillon = !lv.numero;
  document.getElementById("delete-brouillon").hidden = !isBrouillon;
  document.getElementById("delete-annulation").hidden = isBrouillon;
  document.getElementById("delete-title").textContent = isBrouillon ? "Supprimer le brouillon" : "Annuler la lettre";
  if (!isBrouillon) {
    document.getElementById("f-annul-categorie").value = "doublon";
    document.getElementById("f-annul-motif").value = "";
  }
  document.getElementById("delete-sheet").hidden = false;
}

function closeDeleteSheet() {
  const sheet = document.getElementById("delete-sheet");
  if (sheet) sheet.hidden = true;
}

async function confirmDeleteLv() {
  const lv = state.lv;
  if (!lv || lv.id == null) return;
  const isBrouillon = !lv.numero;
  let categorie = null;
  let motif = null;
  if (!isBrouillon) {
    categorie = document.getElementById("f-annul-categorie").value || null;
    motif = document.getElementById("f-annul-motif").value.trim() || null;
  }
  try {
    await rpcLvSupprimer(lv.id, categorie, motif);
    closeDeleteSheet();
    state.lv = null;
    resetUndo();
    await navigate("mes-lv");
  } catch (err) {
    alert("Suppression impossible : " + (err.message || err));
  }
}

async function ensureLv() {
  if (state.lv && state.lv.id) return state.lv.id;
  const prefill = state.prefillData || {};
  const fields = {
    date_etablissement: document.getElementById("f-date").value || todayIso(),
    chauffeur_id: state.chauffeur ? state.chauffeur.id : null,
    owner_email: state.profil ? state.profil.email : null,
    camion_id: toIntOrNull(document.getElementById("f-camion").value) || prefill.camion_id || null,
    client_id: toIntOrNull(document.getElementById("f-client").value) || prefill.client_id || null,
    projet_id: toIntOrNull(document.getElementById("f-projet").value) || prefill.projet_id || null,
    contact_id: toIntOrNull(document.getElementById("f-contact").value) || prefill.contact_id || null,
    statut: "en_cours",
  };
  // Créneaux horaires déjà saisis / repris de la dernière lettre : persistés dès
  // la création pour que la mémoire fonctionne même sans nouvelle interaction.
  const creneaux = collectCreneaux();
  if (creneaux.length) fields.heures = creneaux;
  const lv = await createLv(fields);
  state.lv = lv;
  renderLvNumero();
  // Report automatique (H) : dès que la lettre existe réellement, on persiste la
  // prestation reprise de la dernière lettre du chauffeur (le cas échéant).
  await promotePendingPrestation();
  return lv.id;
}

function wireHeaderAutosave() {
  wireAutosaveField(document.getElementById("f-date"), { table: "lettres_voiture", ensureId: ensureLv, field: "date_etablissement" });
  wireAutosaveField(document.getElementById("f-camion"), { table: "lettres_voiture", ensureId: ensureLv, field: "camion_id", transform: toIntOrNull });
  wireAutosaveField(document.getElementById("f-projet"), { table: "lettres_voiture", ensureId: ensureLv, field: "projet_id", transform: toIntOrNull });
  wireAutosaveField(document.getElementById("f-contact"), { table: "lettres_voiture", ensureId: ensureLv, field: "contact_id", transform: toIntOrNull });
  // beta.22 : adresse choisie de la société (expéditeur + destinataire).
  wireAutosaveField(document.getElementById("f-client-adresse"), { table: "lettres_voiture", ensureId: ensureLv, field: "client_adresse_id", transform: toIntOrNull });
  wireAutosaveField(document.getElementById("f-dest-adresse"), { table: "lettres_voiture", ensureId: ensureLv, field: "dest_adresse_id", transform: toIntOrNull });

  const btnAddCreneau = document.getElementById("btn-add-creneau");
  if (btnAddCreneau) btnAddCreneau.addEventListener("click", addCreneau);

  // Client référencé directement sur la lettre (beta.17) : autosave de client_id
  // + refiltrage Projet/Contact (et purge des valeurs devenues incohérentes).
  wireAutosaveField(document.getElementById("f-client"), { table: "lettres_voiture", ensureId: ensureLv, field: "client_id", transform: toIntOrNull });
  document.getElementById("f-client").addEventListener("change", onClientChange);

  // Destinataire (D) : mode + combobox client -> dest_identique + destinataire_client_id.
  document.getElementById("f-dest-mode").addEventListener("change", saveDestinataire);
  document.getElementById("f-dest-client").addEventListener("change", saveDestinataire);

  // beta.22 (E6) : le champ « Quantité estimée de la journée » a été retiré de
  // l'interface et du PDF (colonne conservée en base, plus saisie ni affichée).
}

function toNumberOrNull(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Pré-remplit la quantité estimée depuis la dernière lettre de ce chauffeur pour
// ce client (mémoire par chauffeur + client), uniquement si le champ est vide.
async function prefillQuantiteEstimee(clientId) {
  const qEl = document.getElementById("f-qte-estimee");
  const qUEl = document.getElementById("f-qte-estimee-unite");
  if (!qEl || !clientId || qEl.value.trim()) return;
  const chauffeurId = state.chauffeur ? state.chauffeur.id : null;
  if (!chauffeurId) return;
  try {
    const last = await rpcDerniereQuantiteEstimee(chauffeurId, toIntOrNull(clientId));
    if (last && last.quantite != null && !qEl.value.trim()) {
      qEl.value = String(last.quantite);
      if (qUEl && !qUEl.value) qUEl.value = last.unite || "";
      qEl.dispatchEvent(new Event("change", { bubbles: true }));
      if (qUEl) qUEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } catch (err) {
    reportIfVersionMismatch(err);
  }
}

/* ---------------------------------------- Complétude de la lettre (beta.20, B+C) ==
 * Lit l'état EN DIRECT depuis le DOM (les autosaves ne rafraîchissent pas state.lv),
 * puis la fonction pure lvCompleteness() liste les mentions obligatoires manquantes.
 * Bandeau « N éléments à compléter avant signature » + champs manquants en rouge. */
function readLvFromDom() {
  const val = (id) => { const e = document.getElementById(id); return e ? e.value : ""; };
  const mode = val("f-dest-mode");
  const lv = {
    client_id: val("f-client") || null,
    date_etablissement: val("f-date") || "",
    contact_id: val("f-contact") || null,
    dest_identique: mode !== "autre_client",
    destinataire_client_id: val("f-dest-client") || null,
  };
  const tours = Array.from(document.querySelectorAll("#tours-list .tour-card")).map((card) => {
    const ch = card.querySelector(".f-site-chargement");
    const de = card.querySelector(".f-site-dechargement");
    const lignes = Array.from(card.querySelectorAll(".f-ligne-article"))
      .map((sel) => ({ article_id: sel.value || null }));
    return {
      site_chargement_id: ch && ch.value ? ch.value : null,
      site_dechargement_id: de && de.value ? de.value : null,
      lignes,
    };
  });
  return { lv, tours };
}

function applyLvRedMarks(missing) {
  document.querySelectorAll("#view-today .field-missing").forEach((el) => el.classList.remove("field-missing"));
  document.querySelectorAll("#view-today .f-ligne-article.field-invalid, #view-today .f-site-chargement.field-invalid, #view-today .f-site-dechargement.field-invalid")
    .forEach((el) => el.classList.remove("field-invalid"));
  for (const m of missing) {
    let el;
    try { el = document.querySelector(m.anchor); } catch (e) { el = null; }
    if (!el) continue;
    const field = el.closest(".field");
    if (field) field.classList.add("field-missing"); else el.classList.add("field-invalid");
  }
}

function jumpToAnchor(sel) {
  let el;
  try { el = document.querySelector(sel); } catch (e) { el = null; }
  if (!el) return;
  const target = el.closest(".field") || el;
  try { target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* noop */ }
  const cb = target.querySelector ? target.querySelector(".cb-input") : null;
  const focusable = cb || (el.matches && el.matches("input,select,textarea") ? el
    : (el.querySelector && el.querySelector("input,select,textarea")) || el);
  setTimeout(() => { try { focusable.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 250);
  target.classList.add("lvc-flash");
  setTimeout(() => target.classList.remove("lvc-flash"), 1100);
}

function refreshLvCompleteness() {
  const box = document.getElementById("lv-completeness");
  if (!box) return;
  const todayView = document.getElementById("view-today");
  if (!state.lv || (todayView && todayView.hidden)) { box.hidden = true; applyLvRedMarks([]); return; }
  const { lv, tours } = readLvFromDom();
  const missing = lvCompleteness(lv, tours, state.refs);
  if (missing.length === 0) { box.hidden = true; applyLvRedMarks([]); return; }
  box.hidden = false;
  const n = missing.length;
  document.getElementById("lvc-summary").textContent =
    `${n} élément${n > 1 ? "s" : ""} à compléter avant signature`;
  const list = document.getElementById("lvc-list");
  list.innerHTML = "";
  for (const m of missing) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lvc-item";
    btn.textContent = m.label;
    btn.addEventListener("click", () => jumpToAnchor(m.anchor));
    li.appendChild(btn);
    list.appendChild(li);
  }
  applyLvRedMarks(missing);
}

let _lvcTimer = null;
function scheduleLvCompleteness() {
  clearTimeout(_lvcTimer);
  _lvcTimer = setTimeout(refreshLvCompleteness, 150);
}

function wireLvCompleteness() {
  const toggle = document.getElementById("lvc-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      document.getElementById("lvc-list").hidden = open;
    });
  }
  const todayView = document.getElementById("view-today");
  if (todayView) todayView.addEventListener("change", scheduleLvCompleteness);
  const toursList = document.getElementById("tours-list");
  if (toursList && typeof MutationObserver !== "undefined") {
    new MutationObserver(scheduleLvCompleteness).observe(toursList, { childList: true, subtree: true });
  }
}

/* ===================================== Barre d'onglets du bas & clavier (beta.21.1)
 * Norme iOS/Android : la barre d'onglets du bas (et la barre de sélection
 * « Signer (N) ») se masque dès que le clavier logiciel s'ouvre — sinon elle
 * chevauche le champ actif et la barre d'accessoires — puis réapparaît à la
 * fermeture. Le masquage est purement CSS (body.keyboard-open) ; les barres
 * étant en position:fixed, les masquer ne décale pas le contenu (aucun saut de
 * mise en page).
 *
 * Signal PRINCIPAL : focusin/focusout sur un champ éditable. C'est le signal
 * fiable en PWA standalone sur iOS, où visualViewport est bogué (WebKit #218983 :
 * la hauteur ne suit pas toujours le clavier). visualViewport sert de COMPLÉMENT
 * (clavier matériel, cas où focusout n'arrive pas). */
function isKeyboardField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const t = (el.type || "text").toLowerCase();
    // Les types sans clavier logiciel (boutons, cases, curseurs…) n'y comptent pas.
    return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes(t);
  }
  return false;
}

function wireKeyboardAwareBars() {
  const body = document.body;
  const setOpen = (open) => body.classList.toggle("keyboard-open", !!open);
  const fieldFocused = () => isKeyboardField(document.activeElement);

  const vv = window.visualViewport;
  const vvShrunk = () => {
    if (!vv) return false;
    // Clavier présumé ouvert si la fenêtre visuelle perd plus de 25 % de hauteur.
    return window.innerHeight - vv.height > window.innerHeight * 0.25;
  };

  document.addEventListener("focusin", (e) => {
    if (isKeyboardField(e.target)) setOpen(true);
  });
  document.addEventListener("focusout", () => {
    // On laisse le focus se déplacer (champ -> champ) avant de décider de réafficher.
    setTimeout(() => { if (!fieldFocused() && !vvShrunk()) setOpen(false); }, 60);
  });

  if (vv) {
    const onVv = () => {
      if (vvShrunk()) setOpen(true);
      else if (!fieldFocused()) setOpen(false);
    };
    vv.addEventListener("resize", onVv);
    vv.addEventListener("scroll", onVv);
  }
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
    // Nouvelle lettre : reprise des créneaux horaires de la dernière lettre
    // (mémoire). À défaut d'historique (premier bon du chauffeur), on pré-remplit
    // un créneau de journée 07:00–16:00 plutôt qu'une ligne vide (retour beta.15).
    if (!lv) {
      let heures = null;
      try {
        heures = await rpcDernieresHeures(chauffeurId);
      } catch (err) {
        /* pas bloquant : on retombe sur le créneau par défaut */
      }
      state.prefillData.heures = (Array.isArray(heures) && heures.length)
        ? heures
        : [{ debut: "07:00", fin: "16:00" }];
    }
  }
  state.lv = lv;
  fillHeaderForm(lv || state.prefillData);
  renderLvNumero();
  refreshDeleteButton();
  await loadPrestationsFor(lv);
  await loadToursFor(lv);
  scheduleLvCompleteness();
}

async function loadToursFor(lv) {
  const listEl = document.getElementById("tours-list");
  listEl.innerHTML = "";
  state.tours = [];
  if (!lv) {
    await renderDraftTour(); // E5 : tour vide dès l'ouverture d'une nouvelle lettre
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
  if (state.tours.length === 0) {
    await renderDraftTour(); // E5 : lettre existante sans tour -> un tour vide proposé
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

  const siteOptions = state.refs.sites || [];
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

  // beta.22.1 : sélecteur hiérarchique (sociétés -> adresses) au lieu d'une liste à plat.
  setupSiteDisplay(chargementSel);
  setupSiteDisplay(dechargementSel);

  node.querySelector(".btn-delete-tour").addEventListener("click", () => handleDeleteTour(entry, node));
  node.querySelector(".btn-add-ligne").addEventListener("click", () => handleAddLigne(entry, node));

  const lignesList = node.querySelector(".lignes-list");
  for (const ligne of lignes) renderLigneRow(lignesList, entry, ligne);

  document.getElementById("tours-list").appendChild(node);
  initTooltips(node);
  return node;
}

function renderLigneRow(lignesList, entry, ligne) {
  const tpl = document.getElementById("tpl-ligne");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.ligneId = ligne.id;

  const articleSel = node.querySelector(".f-ligne-article");
  populateSelect(articleSel, state.refs.articles, (a) => a.id, (a) => a.nom, "Article…");
  articleSel.value = ligne.article_id != null ? String(ligne.article_id) : "";
  enhanceSelect(articleSel, {
    entity: "article", driverId: driverIdForRecents, placeholder: "Article…", wrapClass: "cb-area-article",
    createLabel: "un article",
    onCreate: (text) => openQuickCreate("article", text),
    onEdit: (value) => openQuickCreate("article", "", value), canEdit: () => true,
  });

  const qteInput = node.querySelector(".f-ligne-quantite");
  qteInput.value = frQty(ligne.quantite);

  const uniteSel = node.querySelector(".f-ligne-unite");
  uniteSel.value = ligne.unite || "t";

  wireAutosaveField(articleSel, { table: "tour_lignes", id: ligne.id, field: "article_id", transform: toIntOrNull });
  wireAutosaveField(qteInput, { table: "tour_lignes", id: ligne.id, field: "quantite", transform: parseFrFloat });
  wireAutosaveField(uniteSel, { table: "tour_lignes", id: ligne.id, field: "unite" });

  // Ces 3 champs déclenchent une remise en cache hors-ligne (autosave 600ms).
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

// Crée réellement un tour en base (crée la LV au besoin ; le 1er tour attribue le
// numéro KER-##### via trigger) et renvoie l'entrée { tour, lignes }.
async function createTourEntry() {
  const lvId = await ensureLv();
  const ordre = state.tours.length + 1;
  const tour = await createTour({ lv_id: lvId, ordre });
  const entry = { tour, lignes: [] };
  state.tours.push(entry);
  try {
    state.lv = await getLv(lvId);
  } catch (err) {
    /* ignore */
  }
  renderLvNumero();
  pushServerUndo();
  return entry;
}

function removeDraftTour() {
  const d = document.querySelector('#tours-list [data-draft="1"]');
  if (d) d.remove();
}

async function addTour() {
  try {
    removeDraftTour(); // le « + » remplace l'éventuel tour vide d'ouverture
    const entry = await createTourEntry();
    await renderTourCard(entry);
    await refreshWeightGauge();
  } catch (err) {
    console.error(err);
    alert("Impossible de créer le tour pour le moment (hors ligne ?). La création nécessite un aller-retour réseau.");
  }
}

// beta.22 (E5) : un tour VIDE affiché dès l'ouverture d'une nouvelle lettre. Il
// n'est PAS enregistré tant qu'il est vide (aucune LV créée, aucun numéro, absent
// du PDF) ; il ne bloque rien. Il se « matérialise » en tour réel au 1er choix.
async function renderDraftTour() {
  const tpl = document.getElementById("tpl-tour");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.draft = "1";
  node.querySelector(".tour-card-title").textContent = `Tour n°${state.tours.length + 1}`;

  const chargementSel = node.querySelector(".f-site-chargement");
  const dechargementSel = node.querySelector(".f-site-dechargement");
  const siteOptions = state.refs.sites || [];
  populateSelect(chargementSel, siteOptions, (s) => s.id, (s) => s.nom, "Choisir un site…");
  populateSelect(dechargementSel, siteOptions, (s) => s.id, (s) => s.nom, "Choisir un site…");

  let materializing = false;
  const materialize = async (apply) => {
    if (materializing) return;
    materializing = true;
    try {
      const entry = await createTourEntry();
      node.remove();
      const realNode = await renderTourCard(entry);
      if (apply) await apply(entry, realNode);
      await refreshWeightGauge();
    } catch (err) {
      materializing = false;
      console.error(err);
      alert("Impossible de créer le tour pour le moment (hors ligne ?).");
    }
  };

  const onPickSite = (cssSel) => function () {
    const v = this.value;
    if (!v) return;
    materialize(async (entry, realNode) => {
      const sel = realNode.querySelector(cssSel);
      ensureOption(sel, v, (findSiteById(v) || {}).nom || v);
      sel.value = v;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  chargementSel.addEventListener("change", onPickSite(".f-site-chargement"));
  dechargementSel.addEventListener("change", onPickSite(".f-site-dechargement"));

  // beta.22.1 : sélecteur hiérarchique (sociétés -> adresses).
  const pickerBtns = node.querySelectorAll(".btn-site-picker");
  pickerBtns[0].addEventListener("click", () => openSitePicker(chargementSel));
  pickerBtns[1].addEventListener("click", () => openSitePicker(dechargementSel));
  setupSiteDisplay(chargementSel);
  setupSiteDisplay(dechargementSel);

  node.querySelector(".btn-delete-tour").addEventListener("click", () => node.remove());
  node.querySelector(".btn-add-ligne").addEventListener("click", () =>
    materialize(async (entry, realNode) => handleAddLigne(entry, realNode)));

  document.getElementById("tours-list").appendChild(node);
  initTooltips(node);
}

/* ========================================================= Prestations (H) == */
// Bloc « Prestations » à part, AVANT les tours. Une ligne = prestation + quantité
// + unité + matériel (déduit du camion de la lettre, modifiable). À chaque
// nouvelle lettre, la PREMIÈRE prestation de la dernière lettre du chauffeur est
// reprise (modifiable / supprimable) — cf. promotePendingPrestation().

function defaultMaterielForLv() {
  const camId = state.lv ? state.lv.camion_id : (state.prefillData && state.prefillData.camion_id);
  if (camId == null) return null;
  const cam = (state.refs.camions || []).find((c) => String(c.id) === String(camId));
  return cam && cam.materiel_id != null ? cam.materiel_id : null;
}

async function loadPrestationsFor(lv) {
  const listEl = document.getElementById("prestations-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  state.prestations = [];
  state.pendingPrestation = null;
  if (lv) {
    let lignes = [];
    try {
      lignes = await getPrestationsLv(lv.id);
    } catch (err) {
      reportIfVersionMismatch(err);
    }
    for (const ligne of lignes) {
      state.prestations.push(ligne);
      renderPrestationRow(ligne, false);
    }
    return;
  }
  // Nouvelle lettre : report automatique de la première prestation du chauffeur.
  const chauffeurId = state.chauffeur ? state.chauffeur.id : null;
  if (!chauffeurId) return;
  let prefill = null;
  try {
    prefill = await rpcDernierePrestation(chauffeurId);
  } catch (err) {
    /* pas bloquant */
  }
  if (prefill && (prefill.prestation_id != null || prefill.unite)) {
    state.pendingPrestation = {
      prestation_id: prefill.prestation_id != null ? prefill.prestation_id : null,
      quantite: prefill.quantite != null ? prefill.quantite : null,
      unite: prefill.unite || null,
      materiel_id: prefill.materiel_id != null ? prefill.materiel_id : defaultMaterielForLv(),
    };
    renderPrestationRow(state.pendingPrestation, true);
  }
}

function renderPrestationRow(ligne, pending) {
  const listEl = document.getElementById("prestations-list");
  const tpl = document.getElementById("tpl-prestation");
  const node = tpl.content.firstElementChild.cloneNode(true);
  if (!pending) node.dataset.prestationId = ligne.id;

  const prestSel = node.querySelector(".f-prestation-prestation");
  populateSelect(prestSel, state.refs.prestations, (p) => p.id, (p) => p.libelle, "Prestation…");
  prestSel.value = ligne.prestation_id != null ? String(ligne.prestation_id) : "";
  enhanceSelect(prestSel, { entity: "prestation", driverId: driverIdForRecents, placeholder: "Prestation…", wrapClass: "cb-area-prestation" });

  const qteInput = node.querySelector(".f-prestation-quantite");
  qteInput.value = frQty(ligne.quantite);

  const uniteSel = node.querySelector(".f-prestation-unite");
  uniteSel.value = ligne.unite || "jour";

  const materielSel = node.querySelector(".f-prestation-materiel");
  populateSelect(materielSel, state.refs.materiels, (m) => m.id, (m) => m.libelle, "Matériel…");
  materielSel.value = ligne.materiel_id != null ? String(ligne.materiel_id) : "";
  enhanceSelect(materielSel, { entity: "materiel", driverId: driverIdForRecents, placeholder: "Matériel…", wrapClass: "cb-area-materiel" });

  // Choisir une prestation applique son unité par défaut (catalogue).
  prestSel.addEventListener("change", () => {
    const p = (state.refs.prestations || []).find((x) => String(x.id) === prestSel.value);
    if (p && p.unite_defaut && uniteSel.value !== p.unite_defaut) {
      uniteSel.value = p.unite_defaut;
      uniteSel.dispatchEvent(new Event("change"));
    }
  });

  if (pending) {
    const promote = async () => {
      state.pendingPrestation = {
        prestation_id: toIntOrNull(prestSel.value),
        quantite: parseFrFloat(qteInput.value),
        unite: uniteSel.value || null,
        materiel_id: toIntOrNull(materielSel.value),
      };
      try {
        await ensureLv(); // crée la lettre puis persiste la prestation reprise
      } catch (err) {
        console.error(err);
      }
    };
    [prestSel, qteInput, uniteSel, materielSel].forEach((el) => el.addEventListener("change", promote));
    node.querySelector(".btn-delete-prestation").addEventListener("click", () => {
      state.pendingPrestation = null;
      node.remove();
    });
  } else {
    wireAutosaveField(prestSel, { table: "lv_prestations", id: ligne.id, field: "prestation_id", transform: toIntOrNull });
    wireAutosaveField(qteInput, { table: "lv_prestations", id: ligne.id, field: "quantite", transform: parseFrFloat });
    wireAutosaveField(uniteSel, { table: "lv_prestations", id: ligne.id, field: "unite" });
    wireAutosaveField(materielSel, { table: "lv_prestations", id: ligne.id, field: "materiel_id", transform: toIntOrNull });
    node.querySelector(".btn-delete-prestation").addEventListener("click", () => handleDeletePrestation(ligne, node));
  }
  listEl.appendChild(node);
  return node;
}

// Persiste la prestation reportée dès que la lettre existe (appelé par ensureLv).
async function promotePendingPrestation() {
  if (!state.pendingPrestation || !state.lv) return;
  const p = state.pendingPrestation;
  state.pendingPrestation = null;
  try {
    await createPrestationLigne({
      lv_id: state.lv.id,
      prestation_id: p.prestation_id,
      quantite: p.quantite,
      unite: p.unite,
      materiel_id: p.materiel_id,
      ordre: 1,
    });
    await loadPrestationsFor(state.lv); // remplace la ligne « en attente » par la persistée
    pushServerUndo();
  } catch (err) {
    console.error(err);
    state.pendingPrestation = p; // on ne perd pas la saisie en cas d'échec
  }
}

async function handleAddPrestation() {
  try {
    const lvId = await ensureLv();
    const ligne = await createPrestationLigne({
      lv_id: lvId,
      unite: "jour",
      materiel_id: defaultMaterielForLv(),
      ordre: state.prestations.length + 1,
    });
    state.prestations.push(ligne);
    renderPrestationRow(ligne, false);
    renderLvNumero();
    pushServerUndo();
  } catch (err) {
    console.error(err);
    alert("Impossible d'ajouter la prestation pour le moment (hors ligne ?). La création nécessite un aller-retour réseau.");
  }
}

async function handleDeletePrestation(ligne, node) {
  try {
    await deletePrestationLigne(ligne.id);
    state.prestations = state.prestations.filter((p) => p.id !== ligne.id);
    node.remove();
    pushServerUndo();
  } catch (err) {
    console.error(err);
  }
}

/* ---------------------------------------------- Mise en cache hors-ligne (e/g) */
// Charge estimée / % PTAC supprimés en beta.11 : ce hook ne fait plus que
// entretenir l'instantané hors-ligne et le PDF local (appelé après modification).
async function refreshWeightGauge() {
  await cacheTodaySnapshot();
}

async function cacheTodaySnapshot() {
  if (!state.lv) return;
  const snapshot = {
    savedAt: new Date().toISOString(),
    lv: state.lv,
    tours: state.tours.map(({ tour, lignes }) => ({ tour, lignes })),
    articlesById: Object.fromEntries((state.refs.articles || []).map((a) => [a.id, a.nom])),
    sitesById: Object.fromEntries((state.refs.sites || []).map((s) => [s.id, s.nom])),
  };
  await idbSet("cache", "today-snapshot", snapshot).catch(() => {});
  // Entretien du PDF hors-ligne de la lettre du jour (debounce, chauffeur connecté).
  schedulePdfCacheRefresh(state.lv);
}

/* ============================================= Export PDF de la lettre (g) == */
const PDF_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>';

function connectedChauffeurId() {
  return state.chauffeur && state.chauffeur.id != null ? state.chauffeur.id : null;
}

// Nom du client d'une lettre : via le projet rattaché, sinon l'expéditeur saisi.
function lvClientName(lv) {
  const projet = (state.refs.projets || []).find((p) => p.id === lv.projet_id);
  if (projet) {
    const client = (state.refs.clients || []).find((c) => c.id === projet.client_id);
    if (client && client.raison_sociale) return client.raison_sociale;
  }
  return lv.expediteur || "";
}

// Titre d'une ligne : le numéro KER-xxxxx, ou pour un brouillon sans numéro
// « Brouillon du JJ/MM » + client si connu.
function lvRowTitle(lv) {
  if (lv.numero) return lv.numero;
  const d = formatDateFr(lv.date_etablissement);
  const jjmm = d && d !== "—" ? d.slice(0, 5) : "";
  const client = lvClientName(lv);
  const base = jjmm ? `Brouillon du ${jjmm}` : "Brouillon";
  return client ? `${base} — ${client}` : base;
}

// Construit une ligne de lettre de voiture : zone cliquable (ouvre la lettre) +
// bouton icône PDF (export). Partagé par « Mes lettres de voiture » et la liste
// bureau pour ne pas dupliquer le balisage.
function buildLvRow(lv, { dateText } = {}) {
  const row = document.createElement("div");
  row.className = "lv-row";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "lv-row-open";
  const badge = lvBadge(lv);
  open.innerHTML = `
    <span class="lv-row-main">
      <span class="lv-row-numero">${escapeHtml(lvRowTitle(lv))}</span>
      <span class="lv-row-date">${escapeHtml(dateText != null ? dateText : formatDateFr(lv.date_etablissement))}</span>
    </span>
    <span class="badge badge-${escapeHtml(badge.cls)}">${escapeHtml(badge.label)}</span>`;
  open.addEventListener("click", () => openLvInToday(lv));
  const pdf = document.createElement("button");
  pdf.type = "button";
  pdf.className = "icon-btn lv-row-pdf";
  pdf.title = "Exporter en PDF";
  pdf.setAttribute("aria-label", "Exporter en PDF");
  pdf.innerHTML = PDF_ICON_SVG;
  pdf.addEventListener("click", (e) => { e.stopPropagation(); exportLvPdf(lv); });
  row.append(open, pdf);
  return row;
}

async function sharePdf(blob, filename, generatedNote) {
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text: generatedNote || undefined });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // l'utilisateur a annulé le partage
      // sinon : on bascule sur le téléchargement ci-dessous
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  if (generatedNote) alert(`PDF ${generatedNote}.`);
}

// Récupère le PDF (worker ou cache hors-ligne) puis l'ouvre dans la visionneuse
// INTÉGRÉE (beta.21) — jamais de nouvel onglet/téléchargement bridé par iOS.
async function exportLvPdf(lv) {
  if (!lv || lv.id == null) {
    alert("Enregistrez d'abord la lettre de voiture (aucun numéro).");
    return;
  }
  const filename = `lettre-de-voiture-${lv.numero || lv.id}.pdf`;
  let blob = null;
  let note = null;
  if (navigator.onLine) {
    try {
      blob = await workerLvPdf(lv.id);
      if (shouldCachePdf(lv, connectedChauffeurId())) {
        await pdfCache.put(lv.id, blob, Date.now()).catch(() => {});
      }
    } catch (err) {
      reportIfVersionMismatch(err); // on tentera le cache local
    }
  }
  if (!blob) {
    const cached = await pdfCache.get(lv.id).catch(() => null);
    if (cached && cached.blob) {
      blob = cached.blob;
      note = formatGeneratedAt(cached.generatedAt);
    }
  }
  if (!blob) {
    alert("PDF indisponible hors ligne (aucune version en cache pour cette lettre).");
    return;
  }
  openPdfViewer(blob, filename, note);
}

/* ---- Visionneuse PDF intégrée (beta.21) ------------------------------------ */
let pdfViewerCurrent = null; // { blob, filename, note }

function openPdfViewer(blob, filename, note) {
  pdfViewerCurrent = { blob, filename, note };
  const overlay = document.getElementById("pdf-viewer");
  const pages = document.getElementById("pdf-viewer-pages");
  const title = document.getElementById("pdf-viewer-title");
  if (!overlay || !pages) { sharePdf(blob, filename, note); return; } // repli sûr
  if (title) title.textContent = filename.replace(/\.pdf$/i, "");
  overlay.hidden = false;
  document.body.classList.add("pdf-viewer-open");
  pages.innerHTML = '<p class="pdf-viewer-loading">Chargement du PDF…</p>';
  // Import DYNAMIQUE : pdf.js (~400 Ko) n'est chargé qu'à la 1re ouverture.
  import("./pdf-viewer.js?v=21")
    .then((m) => m.renderPdfInto(blob, pages))
    .catch(() => { pages.innerHTML = '<p class="pdf-viewer-error">Aperçu indisponible. Utilisez « Télécharger ».</p>'; });
}

function closePdfViewer() {
  const overlay = document.getElementById("pdf-viewer");
  const pages = document.getElementById("pdf-viewer-pages");
  if (overlay) overlay.hidden = true;
  if (pages) pages.innerHTML = "";
  document.body.classList.remove("pdf-viewer-open");
  pdfViewerCurrent = null;
}

async function downloadFromPdfViewer() {
  if (!pdfViewerCurrent) return;
  const { blob, filename, note } = pdfViewerCurrent;
  await sharePdf(blob, filename, note);
}

// Régénération debounce du PDF hors-ligne après chaque modification de la lettre
// du jour (chauffeur connecté, lettre non signée).
let pdfRefreshTimer = null;
function schedulePdfCacheRefresh(lv) {
  if (!lv || lv.id == null || lv.statut === "signee" || !hasRole("chauffeur")) return;
  if (!navigator.onLine) return;
  if (pdfRefreshTimer) clearTimeout(pdfRefreshTimer);
  pdfRefreshTimer = setTimeout(async () => {
    pdfRefreshTimer = null;
    try {
      const blob = await workerLvPdf(lv.id);
      await pdfCache.put(lv.id, blob, Date.now());
    } catch (e) { /* best-effort : silencieux */ }
  }, 2500);
}

// Déconnexion : on purge le cache PDF local (documents non signés du chauffeur)
// AVANT de clôturer la session, puis on déconnecte.
async function logout() {
  if (pdfRefreshTimer) { clearTimeout(pdfRefreshTimer); pdfRefreshTimer = null; }
  await pdfCache.purge().catch(() => {});
  await signOut();
}

/* ======================================= Accueil chauffeur (non signées) (f) == */
// Sélection courante : map id -> lv (pour le groupage et la signature).
const signSelection = new Map();

function isSignable(lv) {
  // Une lettre « en attente de signature » (envoyee) est déjà partie : on ne la
  // re-sélectionne pas. Sélectionnables : brouillon / en cours / à signer.
  return lv.statut !== "signee" && lv.statut !== "envoyee";
}

function refreshSelectionBar() {
  const countEl = document.getElementById("signer-count");
  const n = signSelection.size;
  if (countEl) countEl.textContent = String(n);
  // La barre de sélection REMPLACE la barre d'onglets dès qu'une lettre est
  // cochée (body.has-selection pilote l'affichage en CSS).
  const active = n > 0 && state.route === "mes-lv";
  document.body.classList.toggle("has-selection", active);
  // Icône PDF : utile seulement quand une SEULE lettre est cochée.
  const pdfBtn = document.getElementById("btn-selection-pdf");
  if (pdfBtn) pdfBtn.hidden = n !== 1;
}

function clearSignSelection() {
  signSelection.clear();
  refreshSelectionBar();
}

async function loadMesLv() {
  const listEl = document.getElementById("mes-lv-list");
  const showSignees = !!(document.getElementById("mes-lv-show-signees") || {}).checked;
  const showCorbeille = !!(document.getElementById("mes-lv-show-corbeille") || {}).checked;
  const selectAll = document.getElementById("mes-lv-select-all");
  if (selectAll) selectAll.checked = false;
  clearSignSelection();
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  if (showCorbeille) {
    await loadCorbeille(listEl);
    return;
  }
  try {
    const data = await listLettresVoiture();
    // Non signées en haut (la plus récente d'abord, déjà trié par la requête) ;
    // les signées n'apparaissent que sous le filtre « Signées ».
    const rows = (data || []).filter((lv) => (showSignees ? lv.statut === "signee" : lv.statut !== "signee"));
    if (!rows.length) {
      listEl.innerHTML = `<p class="entity-empty">${showSignees ? "Aucune lettre signée." : "Aucune lettre de voiture à signer."}</p>`;
      return;
    }
    listEl.innerHTML = "";
    for (const lv of rows.slice(0, 60)) {
      listEl.appendChild(buildSignableRow(lv, showSignees));
    }
  } catch (err) {
    reportIfVersionMismatch(err);
    listEl.innerHTML = `<p class="muted">Impossible de charger (hors ligne ?) : ${escapeHtml(err.message || String(err))}</p>`;
  }
}

// Corbeille : brouillons mis au rebut (restaurables 30 jours).
async function loadCorbeille(listEl) {
  try {
    const rows = await listCorbeille();
    if (!rows.length) {
      listEl.innerHTML = '<p class="entity-empty">Corbeille vide.</p>';
      return;
    }
    listEl.innerHTML = "";
    for (const lv of rows) {
      const row = document.createElement("div");
      row.className = "lv-row";
      const info = document.createElement("span");
      info.className = "lv-row-open corbeille-row-info";
      info.innerHTML = `<span class="lv-row-main"><span class="lv-row-numero">${escapeHtml(lvRowTitle(lv))}</span>
        <span class="lv-row-date">${escapeHtml(formatDateFr(lv.date_etablissement))}</span></span>`;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "btn btn-secondary btn-sm";
      restore.textContent = "Restaurer";
      restore.addEventListener("click", async () => {
        try {
          await rpcLvRestaurer(lv.id);
          await loadMesLv();
        } catch (err) {
          alert("Restauration impossible : " + (err.message || err));
        }
      });
      row.append(info, restore);
      listEl.appendChild(row);
    }
  } catch (err) {
    reportIfVersionMismatch(err);
    listEl.innerHTML = `<p class="muted">Impossible de charger la corbeille : ${escapeHtml(err.message || String(err))}</p>`;
  }
}

// Icônes des actions de swipe (Lucide, jamais d'emoji — cf. check-no-emoji).
const SWIPE_ICON = {
  signer: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>',
  corbeille: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
};

// Déclenche l'action choisie dans le panneau de swipe pour UNE lettre.
function onSwipeAction(key, lv) {
  if (key === "pdf") { exportLvPdf(lv); return; }
  if (key === "signer") {
    signSelection.clear();
    signSelection.set(lv.id, lv);
    refreshSelectionBar();
    syncSelectAllCheckbox();
    openSignerChoice();
    return;
  }
  if (key === "corbeille") { openDeleteSelectionSheet([lv]); return; }
}

// Ligne de l'accueil chauffeur : case à cocher (si signable) + ligne lettre,
// le tout enveloppé pour le geste de swipe (actions révélées à droite).
function buildSignableRow(lv, isSigned) {
  const row = buildLvRow(lv);
  const signable = !isSigned && isSignable(lv);
  if (signable) {
    const check = document.createElement("label");
    check.className = "lv-row-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", `Sélectionner ${lv.numero || "la lettre"}`);
    input.checked = signSelection.has(lv.id);
    input.addEventListener("change", () => {
      if (input.checked) signSelection.set(lv.id, lv);
      else signSelection.delete(lv.id);
      row.classList.toggle("is-selected", input.checked);
      refreshSelectionBar();
      syncSelectAllCheckbox();
    });
    check.appendChild(input);
    row.insertBefore(check, row.firstChild);
  }
  return wrapRowForSwipe(row, lv, signable);
}

// Enveloppe une .lv-row dans un conteneur de swipe + panneau d'actions à droite.
function wrapRowForSwipe(row, lv, signable) {
  const actions = swipeActionsFor(lv, { signable });
  const clip = document.createElement("div");
  clip.className = "lv-swipe";
  row.classList.add("lv-swipe-content");
  const panel = document.createElement("div");
  panel.className = "lv-row-actions";
  for (const act of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lv-row-action lv-row-action-" + act.key + (act.danger ? " is-danger" : "");
    btn.setAttribute("aria-label", act.label);
    btn.innerHTML = (SWIPE_ICON[act.key] || "") + `<span>${escapeHtml(act.label)}</span>`;
    btn.addEventListener("click", (e) => { e.stopPropagation(); closeOpenSwipe(); onSwipeAction(act.key, lv); });
    panel.appendChild(btn);
  }
  clip.append(row, panel);
  clip.style.setProperty("--actions-w", actions.length * 84 + "px");
  const coarse = (window.matchMedia && window.matchMedia("(hover: none)").matches) || ("ontouchstart" in window);
  attachSwipe(clip, row, panel, {
    panelWidth: () => panel.offsetWidth || actions.length * 84,
    pointerCoarse: !!coarse,
  });
  return clip;
}

function syncSelectAllCheckbox() {
  const selectAll = document.getElementById("mes-lv-select-all");
  if (!selectAll) return;
  const boxes = [...document.querySelectorAll("#mes-lv-list .lv-row-check input")];
  selectAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
}

function onSelectAllChange(checked) {
  document.querySelectorAll("#mes-lv-list .lv-row-check input").forEach((b) => {
    if (b.checked !== checked) { b.checked = checked; b.dispatchEvent(new Event("change")); }
  });
}

// « Signer (N) » : valide le groupage puis ouvre le choix sur place / par mail.
function openSignerChoice() {
  const lvs = [...signSelection.values()];
  const grp = canGroupForSignature(lvs);
  const msgEl = document.getElementById("signer-choice-msg");
  const sheet = document.getElementById("signer-choice-sheet");
  document.getElementById("signer-choice-count").textContent = `(${lvs.length})`;
  if (!grp.ok) {
    alert(grp.reason);
    return;
  }
  if (msgEl) msgEl.textContent = `${plur(lvs.length, "lettre de voiture", "lettres de voiture")}, même contact signataire.`;
  if (sheet) sheet.hidden = false;
}

function closeSignerChoice() {
  const sheet = document.getElementById("signer-choice-sheet");
  if (sheet) sheet.hidden = true;
}

async function doSignSurPlace() {
  const ids = [...signSelection.keys()];
  if (!ids.length) return;
  closeSignerChoice();
  try {
    const res = await workerSignatureSurPlace(ids);
    const urls = (res.lettres || []).map((l) => l.signing_url).filter(Boolean);
    clearSignSelection();
    await loadMesLv();
    // On enchaîne les signatures sur ce téléphone : on ouvre la première ; chaque
    // retour ramène l'utilisateur ici pour la suivante (liste des liens affichée).
    if (urls.length) {
      alert(`${plur(urls.length, "lettre prête", "lettres prêtes")} à signer sur ce téléphone. Ouverture de la première.`);
      window.location.href = urls[0];
    }
  } catch (err) {
    alert("Échec de la préparation sur place : " + (err.message || err));
  }
}

async function doSignParMail() {
  const ids = [...signSelection.keys()];
  if (!ids.length) return;
  closeSignerChoice();
  try {
    const res = await workerSignatureParMail(ids);
    clearSignSelection();
    await loadMesLv();
    alert(`Enveloppe envoyée à ${res.contact_email || "le contact"}. ${plur(ids.length, "lettre de voiture en attente de signature", "lettres de voiture en attente de signature")}.`);
  } catch (err) {
    alert("Échec de l'envoi par mail : " + (err.message || err));
  }
}

/* ---- Actions de la sélection : corbeille groupée + PDF (beta.21) ------------ */
// Répartit la sélection selon la règle existante (lv_supprimer) : brouillon sans
// numéro -> corbeille ; numérotée non signée -> annulée ; signée -> ignorée.
function describeSelectionDeletion(lvs) {
  const corbeille = lvs.filter((lv) => !lv.numero && lv.statut !== "signee");
  const annulee = lvs.filter((lv) => lv.numero && lv.statut !== "signee" && lv.statut !== "annulee");
  const signee = lvs.filter((lv) => lv.statut === "signee");
  const parts = [];
  if (corbeille.length) parts.push(`${plur(corbeille.length, "brouillon", "brouillons")} → corbeille`);
  if (annulee.length) parts.push(`${plur(annulee.length, "lettre", "lettres")} → annulée${annulee.length > 1 ? "s" : ""}`);
  let text = parts.join(", ") || "Aucune lettre supprimable dans la sélection.";
  if (signee.length) text += ` (${plur(signee.length, "lettre signée non modifiée", "lettres signées non modifiées")})`;
  return { corbeille, annulee, signee, text, needsMotif: annulee.length > 0, actionable: corbeille.length + annulee.length > 0 };
}

// Lettres ciblées par la feuille de suppression groupée (sélection, ou une seule
// lettre via le swipe « Corbeille »).
let deletionLvs = [];

function openDeleteSelectionSheet(lvs) {
  deletionLvs = lvs || [...signSelection.values()];
  if (!deletionLvs.length) return;
  const plan = describeSelectionDeletion(deletionLvs);
  document.getElementById("delete-selection-summary").textContent = plan.text;
  const motifBlock = document.getElementById("delete-selection-motif");
  if (motifBlock) motifBlock.hidden = !plan.needsMotif;
  if (plan.needsMotif) document.getElementById("f-annul-lot-categorie").value = "doublon";
  const confirmBtn = document.getElementById("btn-delete-selection-confirm");
  if (confirmBtn) confirmBtn.disabled = !plan.actionable;
  document.getElementById("delete-selection-sheet").hidden = false;
}

function closeDeleteSelectionSheet() {
  const sheet = document.getElementById("delete-selection-sheet");
  if (sheet) sheet.hidden = true;
}

async function confirmDeleteSelection() {
  const lvs = deletionLvs;
  const plan = describeSelectionDeletion(lvs);
  if (!plan.actionable) { closeDeleteSelectionSheet(); return; }
  const ids = lvs.map((lv) => lv.id);
  const categorie = plan.needsMotif ? (document.getElementById("f-annul-lot-categorie").value || null) : null;
  try {
    const res = await rpcLvSupprimerLot(ids, categorie, null);
    closeDeleteSelectionSheet();
    clearSignSelection();
    await loadMesLv();
    const done = [];
    if (res && res.corbeille) done.push(`${plur(res.corbeille, "brouillon mis à la corbeille", "brouillons mis à la corbeille")}`);
    if (res && res.annulee) done.push(`${plur(res.annulee, "lettre annulée", "lettres annulées")}`);
    if (res && res.ignore_signee) done.push(`${plur(res.ignore_signee, "lettre signée non modifiée", "lettres signées non modifiées")}`);
    alert(done.length ? done.join(", ") + "." : "Rien à supprimer.");
  } catch (err) {
    alert("Suppression impossible : " + (err.message || err));
  }
}

// Icône PDF de la barre de sélection : active quand une SEULE lettre est cochée.
function exportSelectedPdf() {
  if (signSelection.size !== 1) return;
  const lv = [...signSelection.values()][0];
  exportLvPdf(lv);
}

// « Nouvelle lettre de voiture » : ouvre l'éditeur du jour (la lettre est créée
// à la première saisie, cf. ensureLv/autosave — modèle « une lettre par jour »).
async function createNewLvAndOpen() {
  state.lv = null;
  await navigate("today");
}

async function openLvInToday(lv) {
  state.lv = lv;
  fillHeaderForm(lv);
  renderLvNumero();
  await loadPrestationsFor(lv);
  await loadToursFor(lv);
  navigate("today");
  scheduleLvCompleteness();
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
      listEl.appendChild(buildLvRow(lv, { dateText: formatDateFr(lv.date_etablissement) }));
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
    listEl.innerHTML = '<p class="entity-empty">Aucune lettre de voiture préparée.</p>';
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
    title: lv.numero || `Lettre de voiture préparée — ${formatDateFr(lv.date_etablissement)}`,
    subtitle: clientNom || "Client non défini",
    metaHtml: `<label class="field-checkbox planning-check">
      <input type="checkbox" class="planning-select" data-lv-id="${lv.id}"> Envoyer
    </label>`,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const dateInput = makeTextInput("date", lv.date_etablissement);
      wireAutosaveField(dateInput, { table: "lettres_voiture", id: lv.id, field: "date_etablissement" });
      grid.appendChild(fieldBlock("Date", dateInput));

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
    let filtered = !query
      ? rows
      : rows.filter((p) => {
          const client = state.refs.clients.find((c) => c.id === p.client_id);
          return (
            (p.nom || "").toLowerCase().includes(query) ||
            (p.ref_contrat || "").toLowerCase().includes(query) ||
            (client && client.raison_sociale.toLowerCase().includes(query))
          );
        });
    if (incompleteChecked("filter-projets-incomplete")) {
      filtered = filtered.filter((p) => entityMissingFields("projets", p).length > 0);
    }
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun projet.</p>';
      return;
    }
    for (const p of filtered) listEl.appendChild(renderProjetCard(p));
  };
  wireFilterInput(document.getElementById("filter-projets"), render);
  wireIncompleteToggle("filter-projets-incomplete", "filter-projets", render);
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
    metaHtml: incompletePill("projets", p) + `<span class="badge badge-${escapeHtml(p.statut || "actif")}">${escapeHtml(p.statut || "actif")}</span>`,
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
/* ===================================================================== *
 * beta.22 (C) : fusion de fiches (Bureau) + bandeau doublons + toast.    *
 * Sélection de 2+ fiches -> choix de la gardée -> fusion réversible.     *
 * ===================================================================== */
let toastTimer = null;
function showToast(message, actionLabel, actionFn) {
  const el = document.getElementById("toast");
  const msg = document.getElementById("toast-msg");
  const act = document.getElementById("toast-action");
  if (!el) return;
  msg.textContent = message;
  if (actionLabel && actionFn) {
    act.hidden = false;
    act.textContent = actionLabel;
    act.onclick = () => { hideToast(); actionFn(); };
  } else {
    act.hidden = true;
    act.onclick = null;
  }
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 4000);
}
function hideToast() {
  const el = document.getElementById("toast");
  if (el) el.hidden = true;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

const FUSION_SPECS = {
  clients: {
    titre: "Fusionner des clients", type: "client",
    listId: "list-clients", newBtnId: "btn-new-client",
    list: listClients, rpc: rpcFusionnerClients, doublons: listDoublonsClients,
    reload: loadClientsScreen,
    label: (r) => r.raison_sociale || `Client #${r.id}`,
    sub: (r) => r.adresse || (Array.isArray(r.aliases) ? r.aliases.join(", ") : (r.alias || "")),
  },
  sites: {
    titre: "Fusionner des sites", type: "site",
    listId: "list-sites", newBtnId: "btn-new-site",
    list: listSites, rpc: rpcFusionnerSites, doublons: listDoublonsSites,
    reload: loadSitesScreen,
    label: (r) => r.nom || `Site #${r.id}`,
    sub: (r) => r.adresse || "",
  },
};

let fusionState = null;

async function openFusionSheet(kind, preselectIds = []) {
  const spec = FUSION_SPECS[kind];
  if (!spec) return;
  const pre = preselectIds.map(String);
  fusionState = { spec, rows: [], checked: new Set(pre), garde: pre[0] || null };
  document.getElementById("fusion-title").textContent = spec.titre;
  const sheet = document.getElementById("fusion-sheet");
  const search = document.getElementById("fusion-search");
  search.value = "";
  let rows = [];
  try { rows = await spec.list(); } catch (err) { rows = []; }
  fusionState.rows = rows.filter((r) => !r.merged_into_id);
  renderFusionList("");
  search.oninput = () => renderFusionList(search.value.toLowerCase());
  document.getElementById("btn-fusion-close").onclick = closeFusionSheet;
  document.getElementById("btn-fusion-confirm").onclick = onFusionConfirm;
  sheet.onclick = (e) => { if (e.target === sheet) closeFusionSheet(); };
  sheet.hidden = false;
}
function closeFusionSheet() {
  const sheet = document.getElementById("fusion-sheet");
  if (sheet) sheet.hidden = true;
  fusionState = null;
}
function renderFusionList(query) {
  if (!fusionState) return;
  const { spec, rows, checked, garde } = fusionState;
  const listEl = document.getElementById("fusion-list");
  listEl.innerHTML = "";
  const filtered = !query ? rows : rows.filter((r) =>
    `${spec.label(r)} ${spec.sub(r)}`.toLowerCase().includes(query));
  for (const r of filtered) {
    const id = String(r.id);
    const item = document.createElement("label");
    item.className = "fusion-item";
    const check = document.createElement("input");
    check.type = "checkbox"; check.className = "fusion-check"; check.value = id;
    check.checked = checked.has(id);
    const main = document.createElement("span");
    main.className = "fusion-item-main";
    const b = document.createElement("b"); b.textContent = spec.label(r);
    const s = document.createElement("small"); s.textContent = spec.sub(r);
    main.append(b, s);
    const keepWrap = document.createElement("span");
    keepWrap.className = "fusion-keep";
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "fusion-garde"; radio.value = id;
    radio.checked = garde === id; radio.disabled = !checked.has(id);
    radio.title = "Garder cette fiche";
    const kl = document.createElement("span"); kl.textContent = "Garder";
    keepWrap.append(kl, radio);
    check.addEventListener("change", () => {
      if (check.checked) { checked.add(id); if (!fusionState.garde) fusionState.garde = id; }
      else { checked.delete(id); if (fusionState.garde === id) fusionState.garde = [...checked][0] || null; }
      renderFusionList(query);
    });
    radio.addEventListener("change", () => { fusionState.garde = id; updateFusionConfirm(); });
    // le clic sur la ligne (hors radio) bascule la case
    item.addEventListener("click", (e) => {
      if (e.target === radio || e.target === check) return;
      check.checked = !check.checked;
      check.dispatchEvent(new Event("change"));
      e.preventDefault();
    });
    item.append(check, main, keepWrap);
    listEl.appendChild(item);
  }
  updateFusionConfirm();
}
function updateFusionConfirm() {
  if (!fusionState) return;
  const btn = document.getElementById("btn-fusion-confirm");
  const { checked, garde } = fusionState;
  const ok = checked.size >= 2 && garde && checked.has(garde);
  btn.disabled = !ok;
  btn.textContent = ok ? `Fusionner ${checked.size} fiches dans la gardée` : "Fusionner";
}
async function onFusionConfirm() {
  if (!fusionState) return;
  const { spec, checked, garde } = fusionState;
  if (checked.size < 2 || !garde) return;
  const others = [...checked].filter((id) => id !== garde).map((id) => Number(id));
  await performFusion(spec, Number(garde), others);
}
async function performFusion(spec, gardeId, otherIds) {
  try {
    await spec.rpc(gardeId, otherIds);
    let undoIds = [];
    try {
      const fusions = await listFusions({ type: spec.type, gardeId });
      undoIds = fusions.slice(0, otherIds.length).map((f) => f.id);
    } catch (err) { /* ignore */ }
    closeFusionSheet();
    await spec.reload();
    showToast(`Fusion effectuée (${otherIds.length + 1} fiches).`, "Annuler", async () => {
      for (const id of undoIds) { try { await rpcFusionAnnuler(id); } catch (err) { /* ignore */ } }
      await spec.reload();
      showToast("Fusion annulée.");
    });
  } catch (err) {
    alert("Fusion impossible : " + (err.message || err));
  }
}
function buildDoublonsBanner(kind, pairs) {
  const banner = document.createElement("div");
  banner.className = "doublons-banner";
  banner.id = `doublons-${kind}`;
  const h = document.createElement("h3");
  h.textContent = `Doublons possibles (${pairs.length})`;
  banner.appendChild(h);
  for (const p of pairs.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "doublons-pair";
    const txt = document.createElement("span");
    txt.textContent = `${p.nom_a} · ${p.nom_b}`;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn btn-secondary btn-sm";
    btn.textContent = "Fusionner";
    btn.addEventListener("click", () => openFusionSheet(kind, [p.id_a, p.id_b]));
    row.append(txt, btn);
    banner.appendChild(row);
  }
  return banner;
}
async function initFusionUI(kind) {
  const spec = FUSION_SPECS[kind];
  const listEl = document.getElementById(spec.listId);
  const newBtn = document.getElementById(spec.newBtnId);
  if (newBtn && !document.getElementById(`btn-fusionner-${kind}`)) {
    const b = document.createElement("button");
    b.type = "button"; b.id = `btn-fusionner-${kind}`;
    b.className = "btn btn-secondary btn-fusionner-toolbar";
    b.textContent = "Fusionner";
    b.addEventListener("click", () => openFusionSheet(kind, []));
    newBtn.insertAdjacentElement("afterend", b);
  }
  const old = document.getElementById(`doublons-${kind}`);
  if (old) old.remove();
  let pairs = [];
  try { pairs = await spec.doublons(); } catch (err) { pairs = []; }
  if (pairs.length && listEl && listEl.parentNode) {
    listEl.parentNode.insertBefore(buildDoublonsBanner(kind, pairs), listEl);
  }
}

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
    let filtered = !query ? rows : rows.filter((c) => c.raison_sociale.toLowerCase().includes(query));
    if (incompleteChecked("filter-clients-incomplete")) {
      filtered = filtered.filter((c) => entityMissingFields("clients", c).length > 0);
    }
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun client.</p>';
      return;
    }
    for (const c of filtered) listEl.appendChild(renderClientCard(c));
  };
  wireFilterInput(document.getElementById("filter-clients"), render);
  wireIncompleteToggle("filter-clients-incomplete", "filter-clients", render);
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
  initFusionUI("clients");
}

function renderClientCard(c, startOpen = false) {
  return createAccordionCard({
    title: c.raison_sociale,
    subtitle: c.siren || "",
    metaHtml: incompletePill("clients", c) + (c.actif ? "" : '<span class="status-pill status-expired">Inactif</span>'),
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
      contactsTitle.textContent = "Contacts signataires";
      body.appendChild(contactsTitle);
      const contactsHelp = document.createElement("p");
      contactsHelp.className = "field-help";
      contactsHelp.textContent = "Signe les lettres de voiture.";
      body.appendChild(contactsHelp);

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
      addContactBtn.textContent = "+ Contact signataire";
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
    metaHtml: incompletePill("contacts", contact) + (contact.signataire ? '<span class="status-pill status-ok">Signataire</span>' : ""),
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
    let filtered = !query ? rows : rows.filter((s) => (s.nom + " " + (s.adresse || "")).toLowerCase().includes(query));
    if (incompleteChecked("filter-sites-incomplete")) {
      filtered = filtered.filter((s) => entityMissingFields("sites", s).length > 0);
    }
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucun site.</p>';
      return;
    }
    for (const s of filtered) listEl.appendChild(renderSiteCard(s));
  };
  wireFilterInput(document.getElementById("filter-sites"), render);
  wireIncompleteToggle("filter-sites-incomplete", "filter-sites", render);
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
  initFusionUI("sites");
}

function renderSiteCard(s, startOpen = false) {
  return createAccordionCard({
    title: s.nom,
    subtitle: s.adresse || "",
    metaHtml: incompletePill("sites", s) + `<span class="badge badge-${s.portee === "chantier" ? "preparee" : "en_cours"}">${escapeHtml(s.portee)}</span>${s.statut === "termine" ? '<span class="status-pill status-expired">Terminé</span>' : ""}`,
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
      grid.appendChild(fieldBlock("Nom (imprimé sur la lettre de voiture)", nomInput));

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
// beta.22 (D) : distance à vol d'oiseau (mètres).
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

// beta.22.1 : modèle « société de sites -> adresses ». Helpers d'affichage.
function siteSocieteOf(site) {
  if (!site || site.societe_id == null) return null;
  return (state.refs.siteSocietes || []).find((x) => String(x.id) === String(site.societe_id)) || null;
}
function siteAdrLabel(site) {
  const soc = siteSocieteOf(site);
  const nom = site.nom || "";
  if (soc && nom.toLowerCase().startsWith((soc.nom + " ").toLowerCase())) return nom.slice(soc.nom.length + 1);
  return nom;
}
function siteGroupedLabel(site) {
  if (!site) return "";
  const soc = siteSocieteOf(site);
  return soc ? `${soc.nom} · ${siteAdrLabel(site)}` : (site.nom || "");
}

// Champ site = bouton d'affichage qui ouvre la feuille hiérarchique (plus de liste
// à plat). Le <select> (caché) conserve la valeur pour l'autosave et la navigation.
function setupSiteDisplay(sel) {
  if (!sel) return;
  sel.classList.add("is-picker-hidden");
  let disp = sel.parentNode.querySelector(".site-display");
  if (!disp) {
    disp = document.createElement("button");
    disp.type = "button";
    disp.className = "site-display";
    sel.parentNode.insertBefore(disp, sel);
  }
  const refresh = () => {
    const s = findSiteById(sel.value);
    disp.textContent = s ? siteGroupedLabel(s) : "Choisir un site…";
    disp.classList.toggle("is-placeholder", !s);
  };
  refresh();
  sel.addEventListener("change", refresh);
  disp.addEventListener("click", () => openSitePicker(sel));
}

function pickSite(site) {
  const target = state.sitePicker && state.sitePicker.target;
  if (target && site) {
    ensureOption(target, String(site.id), site.nom);
    target.value = String(site.id);
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeSitePicker();
}

function openSitePicker(targetSelect) {
  state.sitePicker = { target: targetSelect, level: "societes", societeId: null };
  const sheet = document.getElementById("site-picker-sheet");
  sheet.hidden = false;
  document.getElementById("site-picker-search").value = "";
  const nearBtn = document.getElementById("btn-site-picker-near");
  if (nearBtn) {
    nearBtn.setAttribute("aria-pressed", state.nearPos ? "true" : "false");
    nearBtn.onclick = toggleNearMe;
  }
  renderSitePickerList("");
}
// « Près de moi » : tri par distance via la géolocalisation, seulement avec
// permission. Sans permission, l'appli fonctionne normalement.
async function toggleNearMe() {
  const btn = document.getElementById("btn-site-picker-near");
  if (state.nearPos) { state.nearPos = null; btn.setAttribute("aria-pressed", "false"); renderSitePickerList(document.getElementById("site-picker-search").value.toLowerCase()); return; }
  if (!navigator.geolocation) { showToast("Géolocalisation indisponible sur cet appareil."); return; }
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.nearPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      btn.disabled = false; btn.setAttribute("aria-pressed", "true");
      renderSitePickerList(document.getElementById("site-picker-search").value.toLowerCase());
    },
    () => { btn.disabled = false; showToast("Position non autorisée. Tri par distance indisponible."); },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}
function closeSitePicker() {
  document.getElementById("site-picker-sheet").hidden = true;
  state.sitePicker = null;
}
// Tri d'adresses : « Près de moi » si géoloc, sinon alphabétique ; la dernière
// adresse utilisée remonte en tête.
function sortSiteAdresses(arr) {
  let out = arr.slice();
  if (state.nearPos) {
    out = out
      .map((s) => ({ ...s, _dist: (s.lat != null && s.lon != null) ? haversineM(state.nearPos.lat, state.nearPos.lon, s.lat, s.lon) : Infinity }))
      .sort((a, b) => a._dist - b._dist);
  } else {
    out.sort((a, b) => siteAdrLabel(a).localeCompare(siteAdrLabel(b), "fr"));
  }
  let idx = -1, ts = -Infinity;
  out.forEach((s, i) => {
    const t = s.derniere_utilisation ? Date.parse(s.derniere_utilisation) : -Infinity;
    if (t > ts) { ts = t; idx = i; }
  });
  if (idx > 0) { const [r] = out.splice(idx, 1); out.unshift(r); }
  return out;
}

function siteSheetItem(site, { grouped }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sheet-item";
  const primary = grouped ? siteGroupedLabel(site) : siteAdrLabel(site);
  const dist = (site._dist != null && isFinite(site._dist)) ? ` · ${formatDistance(site._dist)}` : "";
  btn.innerHTML = `${escapeHtml(primary)}<span>${escapeHtml(site.adresse || "")}${escapeHtml(dist)}</span>`;
  btn.addEventListener("click", () => pickSite(site));
  return btn;
}

async function renderSitePickerList(query) {
  const listEl = document.getElementById("site-picker-list");
  const titleEl = document.getElementById("site-picker-title");
  const sp = state.sitePicker || { level: "societes", societeId: null };
  const needle = (query || "").trim().toLowerCase();
  const societes = (state.refs.siteSocietes || []).filter((s) => s.actif !== false);
  const sites = (state.refs.sites || []).filter((s) => s.statut !== "termine" && !s.merged_into_id);
  listEl.innerHTML = "";

  // --- Recherche : à plat sur sociétés ET adresses ---
  if (needle) {
    titleEl.textContent = "Choisir un site";
    const matches = sites.filter((s) => {
      const soc = siteSocieteOf(s);
      return `${soc ? soc.nom + " " : ""}${s.nom} ${s.adresse || ""}`.toLowerCase().includes(needle);
    });
    for (const s of sortSiteAdresses(matches)) listEl.appendChild(siteSheetItem(s, { grouped: true }));
    if (!matches.length) listEl.innerHTML = '<p class="entity-empty">Aucun site trouvé.</p>';
    return;
  }

  // --- Niveau ADRESSES d'une société ---
  if (sp.level === "adresses" && sp.societeId != null) {
    const soc = societes.find((s) => String(s.id) === String(sp.societeId));
    titleEl.textContent = soc ? soc.nom : "Adresses";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "sheet-item sheet-back";
    back.textContent = "‹ Sociétés";
    back.addEventListener("click", () => {
      sp.level = "societes"; sp.societeId = null;
      document.getElementById("site-picker-search").value = "";
      renderSitePickerList("");
    });
    listEl.appendChild(back);
    const adr = sortSiteAdresses(sites.filter((s) => String(s.societe_id) === String(sp.societeId)));
    for (const s of adr) listEl.appendChild(siteSheetItem(s, { grouped: false }));
    return;
  }

  // --- Niveau SOCIÉTÉS (défaut) ---
  titleEl.textContent = "Choisir un site";
  const bySoc = new Map();
  for (const s of sites) {
    const k = s.societe_id != null ? String(s.societe_id) : null;
    if (!bySoc.has(k)) bySoc.set(k, []);
    bySoc.get(k).push(s);
  }
  const socEntries = societes
    .filter((soc) => (bySoc.get(String(soc.id)) || []).length > 0)
    .map((soc) => ({ soc, items: bySoc.get(String(soc.id)) }))
    .sort((a, b) => a.soc.nom.localeCompare(b.soc.nom, "fr"));

  for (const { soc, items } of socEntries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sheet-item";
    if (items.length === 1) {
      btn.innerHTML = `${escapeHtml(soc.nom)}<span>${escapeHtml(items[0].adresse || siteAdrLabel(items[0]))}</span>`;
      btn.addEventListener("click", () => pickSite(items[0]));
    } else {
      btn.classList.add("sheet-item-group");
      btn.innerHTML = `${escapeHtml(soc.nom)}<span>${items.length} adresses</span>`
        + `<span class="sheet-chevron" aria-hidden="true">›</span>`;
      btn.addEventListener("click", () => {
        sp.level = "adresses"; sp.societeId = soc.id;
        renderSitePickerList("");
      });
    }
    listEl.appendChild(btn);
  }
  // Sites autonomes (sans société) : choix direct.
  for (const s of sortSiteAdresses(bySoc.get(null) || [])) {
    listEl.appendChild(siteSheetItem(s, { grouped: false }));
  }
  if (!listEl.children.length) listEl.innerHTML = '<p class="entity-empty">Aucun site.</p>';
}

/* ================================================================ Prestations == */
async function loadPrestationsScreen() {
  const listEl = document.getElementById("list-prestations");
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  let rows = [];
  try {
    rows = await listPrestationsAll();
  } catch (e) {
    reportIfVersionMismatch(e);
  }
  const render = (query) => {
    const filtered = !query ? rows : rows.filter((p) => (p.libelle || "").toLowerCase().includes(query));
    listEl.innerHTML = "";
    if (!filtered.length) {
      listEl.innerHTML = '<p class="entity-empty">Aucune prestation.</p>';
      return;
    }
    for (const p of filtered) listEl.appendChild(renderPrestationCard(p));
  };
  wireFilterInput(document.getElementById("filter-prestations"), render);
  render("");

  document.getElementById("btn-new-prestation").onclick = async () => {
    const libelle = prompt("Libellé de la nouvelle prestation :");
    if (!libelle) return;
    try {
      const prestation = await createPrestation({ libelle, unite_defaut: "jour", actif: true });
      state.refs.prestations.push(prestation);
      rows.unshift(prestation);
      listEl.prepend(renderPrestationCard(prestation, true));
    } catch (e) {
      alert("Création impossible : " + (e.message || e));
    }
  };
}

function renderPrestationCard(p, startOpen = false) {
  return createAccordionCard({
    title: p.libelle,
    subtitle: p.unite_defaut ? "Unité par défaut : " + p.unite_defaut : "",
    metaHtml: p.actif === false ? '<span class="status-pill status-expired">Inactive</span>' : "",
    startOpen,
    bodyBuilder: (body) => {
      const grid = document.createElement("div");
      grid.className = "field-grid";

      const libInput = makeTextInput("text", p.libelle);
      wireAutosaveField(libInput, { table: "prestations", id: p.id, field: "libelle" });
      grid.appendChild(fieldBlock("Libellé (imprimé sur la lettre de voiture)", libInput));

      const uniteSel = document.createElement("select");
      for (const [value, label] of [["jour", "jour"], ["heure", "heure"], ["unite", "unité"]]) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        uniteSel.appendChild(opt);
      }
      uniteSel.value = p.unite_defaut || "jour";
      wireAutosaveField(uniteSel, { table: "prestations", id: p.id, field: "unite_defaut" });
      grid.appendChild(fieldBlock("Unité par défaut", uniteSel));

      const comInput = document.createElement("textarea");
      comInput.value = p.commentaire_interne || "";
      comInput.rows = 2;
      wireAutosaveField(comInput, { table: "prestations", id: p.id, field: "commentaire_interne" });
      grid.appendChild(fieldBlock("Commentaire interne (jamais imprimé)", comInput));

      body.appendChild(grid);

      const actifWrap = document.createElement("div");
      actifWrap.className = "field field-checkbox";
      actifWrap.style.marginTop = "12px";
      const actifLabel = document.createElement("label");
      const actifInput = document.createElement("input");
      actifInput.type = "checkbox";
      actifInput.checked = p.actif !== false;
      actifLabel.append(actifInput, " Prestation active");
      actifWrap.appendChild(actifLabel);
      actifInput.addEventListener("change", async () => {
        try {
          await updatePrestation(p.id, { actif: actifInput.checked });
          p.actif = actifInput.checked;
        } catch (e) {
          alert("Échec : " + (e.message || e));
        }
      });
      body.appendChild(actifWrap);
    },
  });
}

/* ========================================================================= Routage == */
const ROUTE_LOADERS = {
  today: loadToday,
  "mes-lv": loadMesLv,
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
  prestations: loadPrestationsScreen,
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
  if (!ROUTES.includes(route)) route = defaultRouteForMode();
  maybeSwitchModeForRoute(route); // cohérence mode <-> contenu (utilisateurs bureau)
  resetUndo(); // on quitte le formulaire courant : la pile d'annulation repart de zéro
  if (route !== "mes-lv") clearSignSelection(); // on quitte l'accueil : plus de sélection
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
  document.getElementById("btn-add-prestation").addEventListener("click", handleAddPrestation);

  // Sélecteur de vue Chauffeur | Bureau (d).
  document.querySelectorAll(".mode-seg").forEach((b) => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });

  // Bouton d'export PDF de la lettre ouverte (g).
  const btnPdfToday = document.getElementById("btn-pdf-today");
  if (btnPdfToday) btnPdfToday.addEventListener("click", () => exportLvPdf(state.lv));

  // Accueil chauffeur : nouvelle lettre, sélection, signature (f).
  const btnNewLv = document.getElementById("btn-new-lv-chauffeur");
  if (btnNewLv) btnNewLv.addEventListener("click", createNewLvAndOpen);
  const selectAll = document.getElementById("mes-lv-select-all");
  if (selectAll) selectAll.addEventListener("change", () => onSelectAllChange(selectAll.checked));
  const showSignees = document.getElementById("mes-lv-show-signees");
  if (showSignees) showSignees.addEventListener("change", () => loadMesLv());
  const btnSigner = document.getElementById("btn-signer");
  if (btnSigner) btnSigner.addEventListener("click", openSignerChoice);
  const btnSignerClose = document.getElementById("btn-signer-choice-close");
  if (btnSignerClose) btnSignerClose.addEventListener("click", closeSignerChoice);
  const signerSheet = document.getElementById("signer-choice-sheet");
  if (signerSheet) signerSheet.addEventListener("click", (e) => { if (e.target.id === "signer-choice-sheet") closeSignerChoice(); });
  const btnSurPlace = document.getElementById("btn-sign-sur-place");
  if (btnSurPlace) btnSurPlace.addEventListener("click", doSignSurPlace);
  const btnParMail = document.getElementById("btn-sign-par-mail");
  if (btnParMail) btnParMail.addEventListener("click", doSignParMail);

  // Barre de sélection (beta.21) : corbeille groupée + PDF (si 1 cochée).
  const btnSelDelete = document.getElementById("btn-selection-delete");
  if (btnSelDelete) btnSelDelete.addEventListener("click", () => openDeleteSelectionSheet());
  const btnSelPdf = document.getElementById("btn-selection-pdf");
  if (btnSelPdf) btnSelPdf.addEventListener("click", exportSelectedPdf);
  const btnSelDelClose = document.getElementById("btn-delete-selection-close");
  if (btnSelDelClose) btnSelDelClose.addEventListener("click", closeDeleteSelectionSheet);
  const selDelSheet = document.getElementById("delete-selection-sheet");
  if (selDelSheet) selDelSheet.addEventListener("click", (e) => { if (e.target.id === "delete-selection-sheet") closeDeleteSelectionSheet(); });
  const btnSelDelConfirm = document.getElementById("btn-delete-selection-confirm");
  if (btnSelDelConfirm) btnSelDelConfirm.addEventListener("click", confirmDeleteSelection);

  // Visionneuse PDF intégrée (beta.21).
  const btnPdfClose = document.getElementById("btn-pdf-viewer-close");
  if (btnPdfClose) btnPdfClose.addEventListener("click", closePdfViewer);
  const btnPdfDownload = document.getElementById("btn-pdf-viewer-download");
  if (btnPdfDownload) btnPdfDownload.addEventListener("click", downloadFromPdfViewer);

  // Suppression / annulation de la lettre ouverte (beta.15).
  const btnDeleteLv = document.getElementById("btn-delete-lv");
  if (btnDeleteLv) btnDeleteLv.addEventListener("click", openDeleteSheet);
  const btnDeleteClose = document.getElementById("btn-delete-close");
  if (btnDeleteClose) btnDeleteClose.addEventListener("click", closeDeleteSheet);
  const deleteSheet = document.getElementById("delete-sheet");
  if (deleteSheet) deleteSheet.addEventListener("click", (e) => { if (e.target.id === "delete-sheet") closeDeleteSheet(); });
  const btnDelBrouillon = document.getElementById("btn-delete-confirm-brouillon");
  if (btnDelBrouillon) btnDelBrouillon.addEventListener("click", confirmDeleteLv);
  const btnDelAnnul = document.getElementById("btn-delete-confirm-annulation");
  if (btnDelAnnul) btnDelAnnul.addEventListener("click", confirmDeleteLv);
  const showCorbeille = document.getElementById("mes-lv-show-corbeille");
  if (showCorbeille) showCorbeille.addEventListener("change", () => loadMesLv());

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
  document.getElementById("btn-logout-unauthorized").addEventListener("click", () => logout());
  document.getElementById("btn-logout").addEventListener("click", () => logout());

  wireEmailOtpLogin();
  wireReglagesBureauFields();
  initInstall();

  // -------------------------------------------------------- Fiche rapide (beta.17)
  document.getElementById("btn-quick-create-close").addEventListener("click", closeQuickCreate);
  document.getElementById("quick-create-sheet").addEventListener("click", (e) => {
    if (e.target.id === "quick-create-sheet") closeQuickCreate();
  });

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
      alert(`Envoi déclenché manuellement pour ${plur(res.lv ? res.lv.length : ids.length, "lettre de voiture", "lettres de voiture")} (Documenso hors périmètre bêta).`);
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
  initModeForUser(); // vue chauffeur par défaut + sélecteur visible pour le bureau

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
  // Pas de hash explicite : on respecte le mode (chauffeur par défaut). Un hash
  // présent est honoré (navigate() ajuste le mode au besoin).
  const hashRoute = (window.location.hash || "").replace(/^#\//, "");
  navigate(hashRoute || defaultRouteForMode());
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
    prestations: "prestations", utilisateurs: "utilisateurs", reglages: "reglages",
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
  // Infobulles ⓘ du formulaire principal (libellés statiques). Les parties
  // rendues dynamiquement (tours, fiches rapides) rappellent initTooltips().
  initTooltips(document);
  wireLvCompleteness();
  wireKeyboardAwareBars();
  // Mode démo (captures CI) : exposer l'ouverture de fiche rapide pour scénariser
  // la capture « fiche contact avec ⓘ ». Jamais exposé hors démo.
  if (isDemoMode()) window.openQuickCreate = openQuickCreate;

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
