/* swipe-actions.js — gestes de ligne « à la iOS » (Mail / Messages) pour la
 * liste « Mes lettres de voiture » (beta.21).
 *
 * Norme iOS : on glisse la ligne VERS LA GAUCHE pour révéler, À DROITE de la
 * ligne, des actions. Ici : « Signer », « PDF », « Corbeille » (corbeille en
 * rouge, en dernier tout à droite). Un glissement long jusqu'au bout NE
 * déclenche AUCUNE action automatiquement (pas de suppression accidentelle).
 * Pas d'action au glissement vers la droite. Une seule ligne ouverte à la fois,
 * retour élastique, et le geste ne gêne ni le défilement vertical ni la case à
 * cocher (on ne « prend » le geste qu'une fois l'intention horizontale avérée).
 *
 * Partie PURE (quelles actions pour une lettre) testée unitairement ; la partie
 * DOM (attachSwipe) est volontairement mince et sans dépendance.
 */
"use strict";

/** Actions disponibles pour une lettre, dans l'ordre d'affichage (gauche→droite,
 *  la corbeille en dernier = la plus à droite). `signable` = la lettre peut être
 *  signée (ni déjà signée, ni déjà envoyée en signature). */
export function swipeActionsFor(lv, { signable } = {}) {
  const actions = [];
  const isSignee = lv && lv.statut === "signee";
  if (signable && !isSignee) actions.push({ key: "signer", label: "Signer" });
  actions.push({ key: "pdf", label: "PDF" });
  if (!isSignee) actions.push({ key: "corbeille", label: "Corbeille", danger: true });
  return actions;
}

// Une seule ligne ouverte à la fois (référence au module courant).
let openController = null;

export function closeOpenSwipe() {
  if (openController) openController.close();
}

/**
 * Rend `content` glissable à l'intérieur de `clip` pour révéler `panel` (collé à
 * droite). Retourne un contrôleur { close, isOpen }.
 *
 * - `panelWidth()` : largeur réelle du panneau d'actions (px).
 * - `pointerCoarse` : true sur appareil tactile (sinon, pas de JS — le survol CSS
 *   suffit sur ordinateur).
 */
export function attachSwipe(clip, content, panel, { panelWidth, pointerCoarse }) {
  const THRESHOLD = 0.4;     // fraction de la largeur du panneau pour « ouvrir »
  const AXIS_LOCK = 8;       // px avant de décider horizontal vs vertical
  const ELASTIC = 0.35;      // résistance au-delà des bornes (droite, ou trop à gauche)
  let startX = 0, startY = 0, baseX = 0, dragging = false, decided = false, horizontal = false;
  let openX = 0; // position « ouverte » (négative)

  function setX(x) { content.style.transform = `translateX(${x}px)`; }
  function width() { return Math.max(0, panelWidth()); }

  function open() {
    openX = -width();
    content.style.transition = "transform .2s ease";
    setX(openX);
    clip.classList.add("is-swiped");
    openController = controller;
  }
  function close() {
    content.style.transition = "transform .2s ease";
    setX(0);
    clip.classList.remove("is-swiped");
    if (openController === controller) openController = null;
  }
  const controller = { close, isOpen: () => clip.classList.contains("is-swiped") };

  if (!pointerCoarse) {
    // Ordinateur : révélation au survol gérée en CSS ; pas de JS tactile.
    return controller;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Ne pas démarrer un glissement depuis la case à cocher (tap = sélection).
    if (e.target.closest(".lv-row-check")) return;
    dragging = true; decided = false; horizontal = false;
    startX = e.clientX; startY = e.clientY;
    baseX = clip.classList.contains("is-swiped") ? -width() : 0;
    content.style.transition = "none";
  }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) {
        clip.classList.add("is-swiping"); // révèle le panneau d'actions pendant le geste
        if (content.setPointerCapture) {
          try { content.setPointerCapture(e.pointerId); } catch (_) {}
        }
      }
    }
    if (!horizontal) return; // défilement vertical : on laisse filer
    e.preventDefault();
    let x = baseX + dx;
    const min = -width();
    if (x > 0) x = x * ELASTIC;                 // vers la droite au-delà de 0 : élastique
    else if (x < min) x = min + (x - min) * ELASTIC; // au-delà de l'ouverture : élastique
    setX(x);
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    clip.classList.remove("is-swiping");
    if (!horizontal) return;
    const current = baseX + 0; // position finale calculée depuis transform
    const matrix = content.style.transform.match(/-?\d+(\.\d+)?/);
    const x = matrix ? parseFloat(matrix[0]) : current;
    // Ouvre si on a dépassé le seuil d'ouverture ; sinon referme (jamais d'action auto).
    if (x <= -width() * THRESHOLD) open();
    else close();
  }

  content.addEventListener("pointerdown", onDown);
  content.addEventListener("pointermove", onMove, { passive: false });
  content.addEventListener("pointerup", onUp);
  content.addEventListener("pointercancel", onUp);
  return controller;
}
