/* installer.js — page autonome /installer/. Détecte l'appareil, affiche le cas
 * courant en premier puis la liste complète. Module ES (import du moteur partagé). */
import { detectEnv, buildGuide, guideByCaseId, ALL_CASES, ICONS } from "/assets/install-detect.js?v=10";

let deferredPrompt = null;

function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
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
  let h = "";
  if (guide.intro) h += `<p>${esc(guide.intro)}</p>`;
  h += stepsHtml(guide);
  if (guide.note) h += `<p class="muted install-note">${esc(guide.note)}</p>`;
  if (guide.recommend) h += `<p class="muted install-note">${esc(guide.recommend)}</p>`;
  return h;
}

function env() {
  return detectEnv(navigator.userAgent || "", {
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone: isStandalone(),
    hasPrompt: !!deferredPrompt,
  });
}

function render() {
  const e = env();
  const guide = buildGuide(e);
  document.getElementById("installer-standalone").hidden = !e.standalone;

  document.getElementById("installer-current-device").textContent = "Sur votre appareil : " + guide.device;
  const body = document.getElementById("installer-current-body");
  body.innerHTML = guideHtml(guide) + (e.isInApp ? `<button type="button" class="btn btn-secondary btn-sm js-copy">Copier le lien</button>` : "");

  const nativeBtn = document.getElementById("installer-native-btn");
  if (deferredPrompt) {
    nativeBtn.hidden = false;
    nativeBtn.textContent = "Installer l'appli";
  } else {
    nativeBtn.hidden = true;
  }

  const all = ALL_CASES.map(
    (c) => `<section class="doc-platform"><div class="doc-platform-title"><h2>${esc(c.device)}</h2></div>${guideHtml(guideByCaseId(c.caseId))}</section>`
  ).join("");
  document.getElementById("installer-all").innerHTML = all;

  const copy = body.querySelector(".js-copy");
  if (copy) copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText("https://bon.kerlam.fr/"); copy.textContent = "Lien copié"; } catch (err) {}
  });
}

window.addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); deferredPrompt = ev; render(); });
window.addEventListener("appinstalled", () => { deferredPrompt = null; render(); });

document.getElementById("installer-native-btn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch (e) {}
  deferredPrompt = null;
  render();
});

// Exposé pour les captures (émulation d'UA en test) ; sans effet en usage normal.
window.__renderInstaller = render;
render();
