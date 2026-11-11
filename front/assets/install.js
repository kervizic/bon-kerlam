/* install.js — bouton « Installer » du shell + fiche d'aide adaptée à l'appareil.
 *
 * CSP-safe : module ES same-origin, aucun style ni handler inline. La logique de
 * détection et le contenu des guides vivent dans install-detect.js (pur, testé).
 * Importé et initialisé par app.js (wireStaticUI).
 */
import { detectEnv, buildGuide, guideByCaseId, ALL_CASES, ICONS } from "./install-detect.js?v=5";

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

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function stepsHtml(guide) {
  const li = guide.steps
    .map(
      (s, i) =>
        `<li class="install-step"><span class="install-step-icon" aria-hidden="true">${ICONS[s.icon] || ""}</span>` +
        `<span class="install-step-body"><strong><span class="install-step-num">${i + 1}.</span> ${esc(s.title)}</strong>` +
        (s.detail ? `<span>${esc(s.detail)}</span>` : "") +
        `</span></li>`
    )
    .join("");
  return `<ol class="install-steps">${li}</ol>`;
}

function guideHtml(guide) {
  let html = "";
  if (guide.intro) html += `<p>${esc(guide.intro)}</p>`;
  html += stepsHtml(guide);
  if (guide.note) html += `<p class="muted install-note">${esc(guide.note)}</p>`;
  if (guide.recommend) html += `<p class="muted install-note">${esc(guide.recommend)}</p>`;
  return html;
}

function buildSheet(env) {
  const sheet = document.getElementById("install-help-sheet");
  if (!sheet) return;
  const guide = buildGuide(env);
  document.getElementById("install-help-title").textContent = "Installer l'application";
  const body = document.getElementById("install-help-body");
  body.innerHTML =
    `<p class="install-device">${esc(guide.device)}</p>` +
    guideHtml(guide) +
    (env.isInApp
      ? `<div class="install-actions"><button type="button" class="btn btn-secondary btn-sm js-install-copy">Copier le lien</button></div>`
      : "");

  // « Autres appareils » : liste repliable de tous les cas.
  const all = ALL_CASES.filter((c) => c.caseId !== env.caseId)
    .map(
      (c) =>
        `<details class="install-other"><summary>${esc(c.device)}</summary>${guideHtml(guideByCaseId(c.caseId))}</details>`
    )
    .join("");
  const allWrap = document.getElementById("install-help-all");
  allWrap.innerHTML = `<details class="install-others-toggle"><summary>Autres appareils</summary>${all}</details>`;

  const copyBtn = body.querySelector(".js-install-copy");
  if (copyBtn) copyBtn.addEventListener("click", copyLink);
}

async function copyLink() {
  const url = "https://bon.kerlam.fr/";
  try {
    await navigator.clipboard.writeText(url);
    const b = document.querySelector(".js-install-copy");
    if (b) b.textContent = "Lien copié ✓";
  } catch (e) {
    /* clipboard indisponible : l'utilisateur copiera l'adresse manuellement */
  }
}

function openSheet() {
  buildSheet(currentEnv());
  const sheet = document.getElementById("install-help-sheet");
  if (sheet) sheet.hidden = false;
}
function closeSheet() {
  const sheet = document.getElementById("install-help-sheet");
  if (sheet) sheet.hidden = true;
}

async function handleInstallClick() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { /* invite fermée */ }
    deferredPrompt = null;
    return;
  }
  openSheet();
}

function refreshButtonLabels() {
  const guide = buildGuide(currentEnv());
  document.querySelectorAll(".js-install-btn").forEach((btn) => {
    // Ne jamais promettre une invite native qui ne viendra pas.
    btn.textContent = deferredPrompt ? "Installer l'appli" : guide.buttonLabel;
  });
}

function hideInstallZones() {
  document.querySelectorAll(".js-install-zone").forEach((el) => { el.hidden = true; });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  refreshButtonLabels();
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
  refreshButtonLabels();
  document.querySelectorAll(".js-install-btn").forEach((btn) => btn.addEventListener("click", handleInstallClick));
  const closeBtn = document.getElementById("btn-install-help-close");
  if (closeBtn) closeBtn.addEventListener("click", closeSheet);
  const sheet = document.getElementById("install-help-sheet");
  if (sheet) sheet.addEventListener("click", (e) => { if (e.target.id === "install-help-sheet") closeSheet(); });
}
