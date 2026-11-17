/* app-version.test.mjs — test e2e de la MISE À JOUR AUTOMATIQUE de la PWA.
 *
 * app-version.js est une IIFE (aucun export) : on l'exécute dans un bac à sable
 * `vm` avec un DOM, un fetch, un service worker, un sessionStorage et un
 * location.reload() simulés. On vérifie le comportement observable :
 *
 *  1. Un changement de /version.json (nouveau numéro) déclenche, tout seul et
 *     sans fermeture de l'onglet, un rechargement — avec le drapeau de toast armé.
 *  2. Pendant une signature intégrée ouverte (ou un champ en focus), on NE
 *     recharge PAS : on attend le « moment calme », puis on recharge dès qu'il
 *     arrive (fin de signature / perte de focus).
 *  3. Anti-boucle : une fois engagé vers une version, on ne recharge pas une
 *     seconde fois pour la même version.
 *  4. Sans changement de version, aucun rechargement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "app-version.js"), "utf8");

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

// Construit un environnement DOM/navigateur minimal mais fidèle, exécute la
// source d'app-version.js dedans, et renvoie des leviers pour piloter le scénario.
function boot({ loadedVersion = "0.1.0-beta.25", serverVersion = "0.1.0-beta.25", signingOpen = false, fieldFocused = false } = {}) {
  const state = {
    reloaded: 0,
    swUpdated: 0,
    session: Object.create(null),
    docListeners: {},
    winListeners: {},
    intervals: [],
    signingOpen,
    fieldFocused,
  };

  const metaFor = (name) => {
    if (name === 'meta[name="app-version"]') return { getAttribute: () => loadedVersion };
    if (name === 'meta[name="app-rev"]') return { getAttribute: () => "250" };
    return null;
  };

  const document = {
    readyState: "complete",
    visibilityState: "visible",
    get activeElement() {
      return state.fieldFocused ? { tagName: "INPUT", isContentEditable: false } : { tagName: "BODY", isContentEditable: false };
    },
    querySelector: (sel) => metaFor(sel),
    querySelectorAll: () => [],
    getElementById: (id) => (id === "embed-sign-sheet" ? { hidden: !state.signingOpen } : null),
    addEventListener: (type, fn) => { (state.docListeners[type] = state.docListeners[type] || []).push(fn); },
  };

  const location = { pathname: "/", reload: () => { state.reloaded += 1; } };

  const sessionStorage = {
    getItem: (k) => (k in state.session ? state.session[k] : null),
    setItem: (k, v) => { state.session[k] = String(v); },
    removeItem: (k) => { delete state.session[k]; },
  };

  // fetch : /version.json -> { version: serverVersion } ; HTML courant -> même
  // empreinte (rev=250, aucun asset versionné) pour isoler la voie /version.json.
  const fetch = (url) => {
    if (String(url).indexOf("/version.json") === 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: serverVersion }) });
    }
    return Promise.resolve({ ok: true, text: () => Promise.resolve('<meta name="app-rev" content="250">') });
  };

  const navigator = {
    serviceWorker: {
      register: () => Promise.resolve({ update: () => { state.swUpdated += 1; } }),
      addEventListener: () => {},
    },
  };

  const windowObj = {
    location,
    bonSync: { queueLength: 0 },
    caches: undefined,
    addEventListener: (type, fn) => { (state.winListeners[type] = state.winListeners[type] || []).push(fn); },
  };

  const sandbox = {
    document,
    window: windowObj,
    navigator,
    location,
    sessionStorage,
    fetch,
    setInterval: (fn, ms) => { const id = state.intervals.length + 1; state.intervals.push({ id, fn, ms }); return id; },
    clearInterval: (id) => { state.intervals = state.intervals.filter((t) => t.id !== id); },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    Date,
    Promise,
    console,
  };
  windowObj.bonAppVersion = undefined;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  // Déclencheurs manuels pour le scénario.
  state.setSigningOpen = (v) => { state.signingOpen = v; };
  state.setFieldFocused = (v) => { state.fieldFocused = v; };
  state.fireDoc = (type) => (state.docListeners[type] || []).forEach((fn) => fn({}));
  state.fireWin = (type) => (state.winListeners[type] || []).forEach((fn) => fn({}));
  state.runIntervals = () => state.intervals.slice().forEach((t) => t.fn());
  state.window = windowObj;
  return state;
}

test("nouvelle version de /version.json -> l'appli se met à jour seule (toast armé)", async () => {
  const s = boot({ loadedVersion: "0.1.0-beta.25", serverVersion: "0.1.0-beta.25.1" });
  await settle();
  assert.equal(s.reloaded, 1, "l'onglet ouvert doit se recharger tout seul");
  assert.equal(s.session.bon_updated, "1", "le drapeau du toast « Appli mise à jour » doit être posé");
});

test("aucun changement de version -> aucun rechargement", async () => {
  const s = boot({ loadedVersion: "0.1.0-beta.25", serverVersion: "0.1.0-beta.25" });
  await settle();
  assert.equal(s.reloaded, 0, "pas de reload si la version est identique");
});

test("signature intégrée ouverte -> on attend, puis on recharge à la fermeture", async () => {
  const s = boot({ loadedVersion: "0.1.0-beta.25", serverVersion: "0.1.0-beta.25.1", signingOpen: true });
  await settle();
  assert.equal(s.reloaded, 0, "ne JAMAIS recharger pendant une signature");
  // Fin de la signature -> le prochain essai (timer de retry) doit recharger.
  s.setSigningOpen(false);
  s.runIntervals();
  await settle();
  assert.equal(s.reloaded, 1, "recharge dès la fermeture de la signature");
});

test("champ en focus -> on attend, puis on recharge au focusout", async () => {
  const s = boot({ loadedVersion: "0.1.0-beta.25", serverVersion: "0.1.0-beta.25.1", fieldFocused: true });
  await settle();
  assert.equal(s.reloaded, 0, "ne pas recharger pendant une saisie");
  s.setFieldFocused(false);
  s.fireDoc("focusout"); // le code reteste via setTimeout(attemptReload, 50)
  await new Promise((r) => setTimeout(r, 80));
  await settle();
  assert.equal(s.reloaded, 1, "recharge dès que le champ perd le focus");
});

test("anti-boucle : pas de second reload pour la même version", async () => {
  const s = boot({ loadedVersion: "0.1.0-beta.25", serverVersion: "0.1.0-beta.25.1" });
  await settle();
  assert.equal(s.reloaded, 1);
  // Nouveau cycle de vérification (focus fenêtre) pour la MÊME version serveur.
  s.fireWin("focus");
  await settle();
  assert.equal(s.reloaded, 1, "ne doit pas recharger une 2e fois pour la même version (garde VGUARD)");
});
