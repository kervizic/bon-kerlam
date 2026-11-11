/* install.js — logique « Ajouter à l'écran d'accueil » (PWA) pour le shell.
 *
 * CSP-safe : module ES servi same-origin, aucun style ni handler inline.
 * Importé et initialisé par app.js (wireStaticUI).
 *
 * Comportement du bouton `.js-install-btn` :
 *  - Android/Chrome/Edge : si `beforeinstallprompt` a été capté, on déclenche
 *    l'invite native ; sinon on affiche les instructions manuelles (menu ⋮).
 *  - iOS/iPadOS dans Safari : on affiche la fiche d'aide « Partager → Sur
 *    l'écran d'accueil → Ajouter ».
 *  - iOS dans un navigateur intégré (Gmail, Chrome iOS, Facebook, Instagram…) :
 *    message invitant à rouvrir bon.kerlam.fr dans Safari.
 *
 * Les zones `.js-install-zone` sont masquées si l'app tourne déjà en mode
 * installé (standalone).
 */

let deferredPrompt = null;

function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS 13+ se présente comme un « Macintosh » tactile.
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
}

function isIosInAppBrowser() {
  if (!isIos()) return false;
  const ua = navigator.userAgent || "";
  // Navigateurs/intégrations hors Safari sur iOS : l'ajout à l'écran d'accueil
  // n'y est pas disponible (réservé à Safari).
  return /(CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line|GSA)/i.test(ua);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  hideInstallZones();
});

function hideInstallZones() {
  document.querySelectorAll(".js-install-zone").forEach((el) => {
    el.hidden = true;
  });
}

function openHelp(which) {
  const sheet = document.getElementById("install-help-sheet");
  if (!sheet) return;
  ["ios", "ios-inapp", "android"].forEach((key) => {
    const block = document.getElementById("install-help-" + key);
    if (block) block.hidden = key !== which;
  });
  sheet.hidden = false;
}

function closeHelp() {
  const sheet = document.getElementById("install-help-sheet");
  if (sheet) sheet.hidden = true;
}

async function handleInstallClick() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch (e) {
      /* l'utilisateur a fermé l'invite : rien à faire */
    }
    deferredPrompt = null;
    return;
  }
  if (isIosInAppBrowser()) return openHelp("ios-inapp");
  if (isIos()) return openHelp("ios");
  return openHelp("android");
}

export function initInstall() {
  if (isStandalone()) {
    hideInstallZones();
    return;
  }
  document.querySelectorAll(".js-install-btn").forEach((btn) => {
    btn.addEventListener("click", handleInstallClick);
  });
  const closeBtn = document.getElementById("btn-install-help-close");
  if (closeBtn) closeBtn.addEventListener("click", closeHelp);
  const sheet = document.getElementById("install-help-sheet");
  if (sheet) {
    sheet.addEventListener("click", (e) => {
      if (e.target.id === "install-help-sheet") closeHelp();
    });
  }
}
