/* installer.js — page autonome /installer/.
 *
 * CSP-safe : script externe same-origin, aucun inline. Capte
 * `beforeinstallprompt` (Android/Chrome/Edge) et expose un bouton « Installer
 * maintenant » déclenchant l'invite native. Sur les plateformes sans cet
 * évènement (iOS, Firefox…), le bouton reste masqué et les instructions
 * manuelles affichées sur la page suffisent.
 */
(function () {
  "use strict";

  var deferredPrompt = null;
  var btn = document.getElementById("btn-install-android");

  function isStandalone() {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true
    );
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (btn && !isStandalone()) btn.hidden = false;
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    if (btn) btn.hidden = true;
  });

  if (btn) {
    btn.addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      var choice = deferredPrompt.userChoice;
      if (choice && choice.finally) {
        choice.finally(function () {
          deferredPrompt = null;
          btn.hidden = true;
        });
      } else {
        deferredPrompt = null;
        btn.hidden = true;
      }
    });
  }
})();
