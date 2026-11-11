/* sw.js — service worker versionné, bon.kerlam.fr.
 *
 * Règle d'or : ne JAMAIS servir une version cassée. On bump VERSION à chaque
 * déploiement qui touche ce fichier (il est lui-même servi en no-cache côté
 * nginx, cf. front/nginx.conf, donc le navigateur va toujours chercher la
 * dernière définition du SW).
 *
 * - install  : skipWaiting() immédiat (pas de phase "waiting" qui bloquerait
 *              la mise à jour tant qu'un onglet reste ouvert).
 * - activate : purge tous les caches d'une version précédente + clients.claim()
 *              pour prendre le contrôle des pages déjà ouvertes sans reload forcé
 *              ici (le reload, lui, est piloté par assets/app-version.js via
 *              l'event "controllerchange", et n'a lieu qu'à un moment calme).
 * - fetch    : network-first pour le HTML et tout ce qui n'est pas versionné
 *              (manifest, sw.js lui-même, app-version.js, API) ; cache-first
 *              pour les assets versionnés par ?v=... (immutables par construction).
 *              Jamais d'interception des requêtes cross-origin (API Supabase,
 *              api-adresse.data.gouv.fr) ni des méthodes non-GET.
 */
"use strict";

const VERSION = "0.1.0-beta.4";
const CACHE_NAME = `bon-kerlam-${VERSION}`;
const VERSIONED_QS_RE = /\?v=/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Jamais d'interception des mutations : elles doivent toujours taper le réseau
  // (et laisser l'autosave / la queue IndexedDB de app.js gérer le hors-ligne).
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin (API Supabase self-hosted, api-adresse.data.gouv.fr...) : jamais
  // touché par le SW, ni mis en cache, ni réécrit.
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  const isVersionedAsset = VERSIONED_QS_RE.test(url.search);

  if (isHTML || !isVersionedAsset) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: "no-store" });
    if (res && res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone()).catch(() => {});
  }
  return res;
}
