/* install.js — bouton « Installer » + fiche d'aide PWA, pilotés par la détection
 * OS/navigateur/version de install-detect.js. CSP-safe (module ES same-origin,
 * aucun style ni handler inline). Importé/initialisé par app.js (wireStaticUI).
 *
 *  - Invite native (beforeinstallprompt) quand elle existe (Android/Chrome/Edge,
 *    ordinateur Chrome/Edge) : le bouton dit « Installer l'appli » et déclenche
 *    l'invite du navigateur.
 *  - Sinon : le bouton dit « Comment installer » (ou « Ouvrir dans Safari » pour
 *    un navigateur intégré iOS) et ouvre une fiche avec les étapes EXACTES du cas
 *    courant + un dépliant « Autres appareils ».
 *  - Masqué si l'app tourne déjà en mode installé (standalone).
 */

import { detectEnv, buildGuide, ALL_CASES, guideByCaseId, ICONS } from "./install-detect.js";

let deferredPrompt = null;

function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

function currentEnv() {
  return detectEnv(navigator.userAgent || "", {
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone: isStandalone(),
    hasPrompt: !!deferredPrompt,
  });
}

function hideInstallZones() {
  document.querySelectorAll(".js-install-zone").forEach((el) => { el.hidden = true; });
}

function iconHtml(key) {
  return ICONS[key] || ICONS.install || "";
}

function stepsHtml(steps) {
  return steps
    .map(
      (s, i) => `
      <li class="install-step">
        <span class="install-step-icon" aria-hidden="true">${iconHtml(s.icon)}</span>
        <span class="install-step-body"><strong><span class="install-step-num">${i + 1}.</span> ${escapeHtml(s.title)}</strong><span>${escapeHtml(s.detail)}</span></span>
      </li>`
    )
    .join("");
}

function guideHtml(guide, { withOthers } = {}) {
  let html = "";
  if (guide.intro) html += `<p>${escapeHtml(guide.intro)}</p>`;
  html += `<ol class="install-steps">${stepsHtml(guide.steps)}</ol>`;
  if (guide.note) html += `<p class="muted install-note">${escapeHtml(guide.note)}</p>`;
  if (guide.recommend) html += `<p class="muted install-note">${escapeHtml(guide.recommend)}</p>`;
  if (guide.inApp) {
    html += `<div class="install-actions"><button type="button" class="btn btn-secondary btn-sm js-copy-link">Copier le lien</button></div>`;
  }
  if (withOthers) {
    const items = ALL_CASES.map(
      (c) => `<li><button type="button" class="install-other-link" data-case="${c.caseId}">${escapeHtml(c.device)}</button></li>`
    ).join("");
    html += `
      <details class="install-others">
        <summary>Autres appareils</summary>
        <ul class="install-other-list">${items}</ul>
        <div class="install-other-detail" id="install-other-detail" hidden></div>
      </details>`;
  }
  return html;
}

function renderHelp(guide) {
  const title = document.getElementById("install-help-title");
  const content = document.getElementById("install-help-body");
  if (title) title.textContent = guide.inApp ? "Ouvrir dans Safari" : "Installer l'application";
  if (!content) return;
  content.innerHTML = `<div class="install-help-block"><p class="install-device">${escapeHtml(guide.device)}</p>${guideHtml(guide, { withOthers: true })}</div>`;
  content.querySelectorAll(".install-other-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = guideByCaseId(btn.dataset.case);
      const box = document.getElementById("install-other-detail");
      if (box) {
        box.innerHTML = `<p class="install-device">${escapeHtml(g.device)}</p>${guideHtml(g, { withOthers: false })}`;
        box.hidden = false;
        wireCopyLink(box);
      }
    });
  });
  wireCopyLink(content);
}

function wireCopyLink(scope) {
  scope.querySelectorAll(".js-copy-link").forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async () => {
      const url = "https://bon.kerlam.fr/";
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Lien copié ✓";
      } catch (e) {
        btn.textContent = url;
      }
    });
  });
}

function openHelp() {
  const sheet = document.getElementById("install-help-sheet");
  if (!sheet) return;
  renderHelp(buildGuide(currentEnv()));
  sheet.hidden = false;
}

function closeHelp() {
  const sheet = document.getElementById("install-help-sheet");
  if (sheet) sheet.hidden = true;
}

async function handleInstallClick() {
  if (deferredPrompt) {
    const p = deferredPrompt;
    deferredPrompt = null;
    p.prompt();
    try { await p.userChoice; } catch (e) { /* invite fermée */ }
    updateButtons();
    return;
  }
  openHelp();
}

function updateButtons() {
  const guide = buildGuide(currentEnv());
  document.querySelectorAll(".js-install-btn .js-install-label").forEach((el) => {
    el.textContent = guide.buttonLabel;
  });
  // Repli : boutons sans <span> de libellé dédié (on ne touche pas à l'icône).
  document.querySelectorAll(".js-install-btn").forEach((btn) => {
    if (!btn.querySelector(".js-install-label")) {
      const node = [...btn.childNodes].reverse().find((n) => n.nodeType === 3 && n.textContent.trim());
      if (node) node.textContent = " " + guide.buttonLabel;
    }
  });
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  updateButtons();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  hideInstallZones();
});

export function initInstall() {
  if (isStandalone()) {
    hideInstallZones();
    return;
  }
  updateButtons();
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
