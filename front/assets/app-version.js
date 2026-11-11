/* =============================================================================
   app-version.js — mise à jour forcée du shell (PWA bon.kerlam.fr).

   Adapté de la version KERTEC (même principe de base : empreinte du shell =
   liste ordonnée des assets versionnés `?v=NN` + <meta name="app-rev">, vérifiée
   périodiquement par un fetch no-store du HTML courant) avec trois ajouts
   nécessaires pour une PWA de saisie terrain :

   1. "Moment calme" obligatoire avant tout reload : on ne recharge JAMAIS si
      la file de synchronisation sortante (window.bonSync.queueLength, mise à
      jour par app.js) est non vide, ou si un champ a le focus — un chauffeur
      au milieu d'une saisie ne doit jamais perdre sa frappe ou une ligne non
      encore envoyée. On réessaie en boucle jusqu'au moment calme.
   2. Coordination avec le service worker : on enregistre /sw.js, et quand un
      nouveau SW prend le contrôle (controllerchange — le SW a fait lui-même
      skipWaiting()+clients.claim() à l'activation, cf. sw.js), on purge les
      caches HTTP puis on déclenche un reload "sûr" (soumis à la règle 1).
   3. Signal explicite "version client trop ancienne" : app.js (ou tout code
      appelant l'API) peut déclencher window.bonAppVersion.notifyServerVersionTooOld()
      ou émettre l'event `bon:api-version-mismatch` sur window — même traitement
      que les deux autres déclencheurs (purge + reload sûr).

   Aucune dépendance, aucun framework. Chargé en <script defer> par index.html,
   avant app.js (module).
   ============================================================================= */
(function () {
  "use strict";

  var CHECK_INTERVAL_MS = 5 * 60 * 1000;   // re-vérification HTML tant que l'app reste ouverte
  var RETRY_WHEN_BUSY_MS = 4 * 1000;       // fréquence de retentative si pas de "moment calme"
  var GUARD_KEY = "bon_update_target";     // anti-boucle : empreinte vers laquelle on a déjà rechargé
  var checking = false;

  function normalize(url, ver) { return url.split("?")[0] + "=" + ver; }

  // Empreinte du shell actuellement EXÉCUTÉ (lue dans le DOM vivant).
  function liveSig() {
    var parts = [];
    var nodes = document.querySelectorAll("link[href], script[src]");
    for (var i = 0; i < nodes.length; i++) {
      var u = nodes[i].getAttribute("href") || nodes[i].getAttribute("src") || "";
      var m = u.match(/\?v=([^&]+)/);
      if (m) parts.push(normalize(u, m[1]));
    }
    var meta = document.querySelector('meta[name="app-rev"]');
    parts.push("rev=" + (meta ? meta.getAttribute("content") || "0" : "0"));
    return parts.join("|");
  }

  // Empreinte d'un HTML fraîchement récupéré du serveur (mêmes règles que liveSig).
  function htmlSig(html) {
    var parts = [], re = /(?:href|src)="([^"]+?\?v=([^"&]+))"/g, m;
    while ((m = re.exec(html)) !== null) parts.push(normalize(m[1], m[2]));
    var rev = html.match(/name="app-rev"[^>]*content="([^"]*)"/i);
    parts.push("rev=" + (rev ? rev[1] : "0"));
    return parts.join("|");
  }

  var LOADED = liveSig();

  // --------------------------------------------------------- Moment calme ---

  function isFieldFocused() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function queueLength() {
    try {
      if (window.bonSync && typeof window.bonSync.queueLength === "number") {
        return window.bonSync.queueLength;
      }
    } catch (e) {}
    return 0;
  }

  function isCalmMoment() {
    return queueLength() === 0 && !isFieldFocused() && document.visibilityState !== "hidden";
  }

  var pendingReason = null;   // 'html' | 'sw' | 'server' | null
  var retryTimer = null;

  function purgeCaches() {
    if (!(window.caches && caches.keys)) return Promise.resolve();
    return caches
      .keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .catch(function () {});
  }

  function doReloadNow() {
    var go = function () { window.location.reload(); };
    purgeCaches().then(go, go);
  }

  function attemptReload() {
    if (!pendingReason) return;
    if (!isCalmMoment()) {
      if (!retryTimer) {
        retryTimer = setInterval(function () {
          if (isCalmMoment()) {
            clearInterval(retryTimer);
            retryTimer = null;
            doReloadNow();
          }
        }, RETRY_WHEN_BUSY_MS);
      }
      return;
    }
    doReloadNow();
  }

  // Appelable par n'importe quel déclencheur (HTML diff, SW, serveur) : enregistre
  // l'intention de recharger puis tente immédiatement (retombe en boucle de retry
  // si on n'est pas dans un moment calme).
  function safeReload(reason) {
    pendingReason = reason;
    attemptReload();
  }

  // Dès qu'un champ perd le focus ou que la file se vide, on retente tout de suite
  // plutôt que d'attendre le prochain tick de retryTimer.
  document.addEventListener(
    "focusout",
    function () {
      if (pendingReason) setTimeout(attemptReload, 50);
    },
    true
  );
  window.addEventListener("bonsync:change", function () {
    if (pendingReason) attemptReload();
  });

  // --------------------------------------------------- Diff HTML périodique ---

  function check() {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    var url = window.location.pathname + "?_=" + Date.now();
    fetch(url, { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) return;
        var latest = htmlSig(html);
        if (!/rev=/.test(latest)) return; // garde-fou : HTML illisible -> on ne touche à rien
        if (latest === LOADED) {
          try { sessionStorage.removeItem(GUARD_KEY); } catch (e) {}
          return;
        }
        var target = null;
        try { target = sessionStorage.getItem(GUARD_KEY); } catch (e) {}
        if (target === latest) return; // déjà engagé vers cette version -> stop boucle
        try { sessionStorage.setItem(GUARD_KEY, latest); } catch (e) {}
        safeReload("html");
      })
      .catch(function () {})
      .then(function () { checking = false; });
  }

  // ----------------------------------------------- Coordination service worker --

  function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(function () {});

    var handled = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      // Le SW a déjà fait self.skipWaiting() + clients.claim() à son activation
      // (cf. sw.js) : controllerchange signifie qu'une nouvelle version est déjà
      // active. On purge le cache HTTP du navigateur puis on recharge dès que
      // c'est sûr (règle du moment calme).
      if (handled) return;
      handled = true;
      safeReload("sw");
    });
  }

  // --------------------------------------------- Signal "version trop vieille" --

  function notifyServerVersionTooOld() {
    safeReload("server");
  }
  window.addEventListener("bon:api-version-mismatch", notifyServerVersionTooOld);

  // API publique minimale, utilisée par app.js.
  window.bonAppVersion = {
    forceCheck: check,
    notifyServerVersionTooOld: notifyServerVersionTooOld,
  };

  // Déclencheurs : lancement, intervalle régulier, retour au premier plan,
  // restauration depuis le bfcache (Safari/iOS).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check);
  } else {
    check();
  }
  setInterval(check, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("pageshow", function (e) { if (e.persisted) check(); });

  initServiceWorker();
})();
