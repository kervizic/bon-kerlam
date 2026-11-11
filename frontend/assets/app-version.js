/* ==========================================================================
   bon.kerlam.fr — mecanisme de mise a jour forcee (zero dependance).
   Adapte et ameliore depuis map.kertec.fr.

   Principe de reference :
   - re-telecharger le HTML courant en no-store,
   - calculer une empreinte (liste des assets "?v=" + meta app-version),
   - si differente : vider les caches, desenregistrer/renouveler les SW, recharger.
   Declencheurs : chargement, setInterval 5 min, visibilitychange, pageshow bfcache.
   Garde anti-boucle en sessionStorage.

   Ameliorations :
   (1) ne JAMAIS recharger tant que la file d'envoi n'est pas vide OU qu'un champ
       a le focus -> on attend le prochain moment calme ;
   (2) service worker versionne : updatefound / controllerchange -> rechargement sur ;
   (3) en-tete API X-App-Version divergente -> rechargement sur.
   ========================================================================== */
(function () {
  'use strict';

  var BUILT_VERSION = "__APP_VERSION__";
  var CHECK_INTERVAL = 5 * 60 * 1000;        // 5 minutes
  var LOOP_GUARD_KEY = 'bon-reload-guard';
  var LOOP_GUARD_MAX = 3;                     // rechargements max dans la fenetre
  var LOOP_GUARD_WINDOW = 60 * 1000;         // 60 s

  var reloadArmed = false;                    // un rechargement est demande, en attente d'un moment calme

  /* ---- Empreinte : assets "?v=" presents + meta app-version ---------- */
  function currentFingerprint(doc) {
    doc = doc || document;
    var parts = [];
    var nodes = doc.querySelectorAll('link[href*="?v="], script[src*="?v="]');
    for (var i = 0; i < nodes.length; i++) {
      var url = nodes[i].getAttribute('href') || nodes[i].getAttribute('src') || '';
      var m = url.match(/[?&]v=([^&]*)/);
      if (m) parts.push(m[1]);
    }
    var meta = doc.querySelector('meta[name=app-version]');
    parts.push(meta ? (meta.getAttribute('content') || '') : '');
    return parts.join('|');
  }

  var LOCAL_FP = currentFingerprint(document);

  /* ---- Garde anti-boucle ------------------------------------------- */
  function loopGuardTrips() {
    var now = Date.now();
    var raw = [];
    try { raw = JSON.parse(sessionStorage.getItem(LOOP_GUARD_KEY) || '[]'); } catch (e) { raw = []; }
    raw = raw.filter(function (t) { return now - t < LOOP_GUARD_WINDOW; });
    raw.push(now);
    try { sessionStorage.setItem(LOOP_GUARD_KEY, JSON.stringify(raw)); } catch (e) {}
    return raw.length > LOOP_GUARD_MAX;
  }

  /* ---- Conditions de calme (ameliorations 1) ----------------------- */
  function queueEmpty() {
    try { return typeof window.__bonQueueEmpty !== 'function' || window.__bonQueueEmpty() === true; }
    catch (e) { return true; }
  }
  function hasFocus() {
    if (typeof window.__bonHasFocus === 'function') {
      try { if (window.__bonHasFocus()) return true; } catch (e) {}
    }
    var a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable));
  }
  function isCalm() { return queueEmpty() && !hasFocus(); }

  /* ---- Rechargement sur : purge caches + SW, puis reload ----------- */
  function doHardReload() {
    if (loopGuardTrips()) { return; }  // trop de rechargements -> on abandonne
    var chain = Promise.resolve();

    if (window.caches && caches.keys) {
      chain = chain.then(function () {
        return caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        });
      }).catch(function () {});
    }

    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      chain = chain.then(function () {
        return navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) {
            // Pousser le nouveau SW s'il attend, sinon desenregistrer.
            if (r.waiting) { try { r.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {} }
            return r.unregister ? r.unregister() : null;
          }));
        });
      }).catch(function () {});
    }

    chain.then(function () {
      var u = new URL(location.href);
      u.searchParams.set('_r', Date.now().toString());  // casser tout cache navigateur
      location.replace(u.toString());
    });
  }

  /* ---- Armement : on attend un moment calme ------------------------ */
  function requestReload(reason) {
    reloadArmed = true;
    if (isCalm()) { doHardReload(); return; }
    // sinon : on retentera a blur / online (file videe) / retour premier plan.
  }

  function tryArmedReload() {
    if (reloadArmed && isCalm()) { doHardReload(); }
  }

  /* ---- Verification serveur : re-telecharger le HTML en no-store --- */
  function checkForUpdate() {
    if (!navigator.onLine) return;
    fetch(location.pathname, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var remoteFp = currentFingerprint(doc);
        if (remoteFp && remoteFp !== LOCAL_FP) { requestReload('fingerprint'); }
      })
      .catch(function () {});
  }

  /* ---- Amelioration (3) : en-tete API X-App-Version --------------- */
  window.__bonOnServerVersion = function (srvVer) {
    if (srvVer && BUILT_VERSION && srvVer !== BUILT_VERSION) { requestReload('x-app-version'); }
  };

  /* ---- Amelioration (2) : service worker versionne --------------- */
  function wireServiceWorker() {
    if (!navigator.serviceWorker) return;
    // Nouveau SW prend le controle -> recharger proprement.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      requestReload('controllerchange');
    });
    navigator.serviceWorker.ready.then(function (reg) {
      if (!reg) return;
      reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          // Nouveau SW installe alors qu'un ancien controle encore la page.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            if (reg.waiting) { try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {} }
            requestReload('updatefound');
          }
        });
      });
      // Forcer une recherche de MAJ du SW aux moments de check.
      try { reg.update(); } catch (e) {}
    }).catch(function () {});
  }

  /* ---- Declencheurs ------------------------------------------------ */
  function onVisible() { if (!document.hidden) { tryArmedReload(); checkForUpdate(); } }

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { checkForUpdate(); }  // bfcache iOS
    tryArmedReload();
  });
  window.addEventListener('focus', tryArmedReload);
  window.addEventListener('blur', tryArmedReload);
  window.addEventListener('online', function () { tryArmedReload(); checkForUpdate(); });
  // Quand la file se vide, app.js bascule l'indicateur ; on retente ici aussi.
  window.addEventListener('bon:queue-empty', tryArmedReload);

  setInterval(function () { checkForUpdate(); try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { r && r.update(); }); } catch (e) {} }, CHECK_INTERVAL);

  // Demarrage.
  wireServiceWorker();
  // Premiere verification peu apres le chargement (laisser l'app booter).
  setTimeout(checkForUpdate, 3000);
})();
