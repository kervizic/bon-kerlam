/* ==========================================================================
   bon.kerlam.fr — Service Worker versionne.
   - install : pre-cache du shell + skipWaiting
   - activate : clients.claim + suppression des caches d'autres versions
   - API : network-first (fallback cache)
   - assets versionnes (?v=) : cache-first
   - navigation : network-first, fallback index.html en cache (offline)
   ========================================================================== */
'use strict';

var VERSION = "__APP_VERSION__";
var SHELL_CACHE = "bon-shell-" + VERSION;
var RUNTIME_CACHE = "bon-runtime-" + VERSION;

var SHELL_ASSETS = [
  '/',
  '/index.html',
  '/assets/styles.css?v=' + VERSION,
  '/assets/app.js?v=' + VERSION,
  '/assets/app-version.js?v=' + VERSION,
  '/manifest.webmanifest?v=' + VERSION,
  '/assets/icons/icon-192.png?v=' + VERSION,
  '/assets/icons/icon-512.png?v=' + VERSION
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll strict echouerait si un asset manque : on tolere les absents.
      return Promise.all(SHELL_ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) { return caches.delete(k); }
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') { self.skipWaiting(); }
});

function isApi(url) { return url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/auth/') === 0; }
function isVersionedAsset(url) { return url.searchParams.has('v') && url.pathname.indexOf('/assets/') === 0; }

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;  // ne pas intercepter le cross-origin

  // API / auth : network-first, fallback cache.
  if (isApi(url)) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  // Assets versionnes : cache-first (immuables par ?v=).
  if (isVersionedAsset(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          return res;
        });
      })
    );
    return;
  }

  // Navigation : network-first, fallback index.html en cache (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('/index.html').then(function (r) { return r || caches.match('/'); });
      })
    );
    return;
  }

  // Reste : cache puis reseau.
  event.respondWith(
    caches.match(req).then(function (cached) { return cached || fetch(req); })
  );
});
