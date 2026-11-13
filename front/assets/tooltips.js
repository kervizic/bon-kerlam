/* tooltips.js — infobulles ⓘ (beta.20).
 *
 * UN SEUL endroit pour les TEXTES d'aide (objet TOOLTIPS, facile à modifier) et
 * la mécanique d'affichage. Pensé pour l'iPhone (pas de survol) : chaque champ
 * porte une petite icône Lucide « info » à droite de son libellé ; un toucher
 * ouvre une bulle courte, un toucher ailleurs / sur l'icône / Échap la ferme.
 *
 * Accessibilité : l'icône est un <button type=button> (ne déclenche jamais le
 * clavier), avec aria-label + aria-expanded ; la bulle a role="tooltip" et est
 * liée au bouton par aria-describedby quand elle est ouverte. La bulle est
 * insérée EN FLUX sous le libellé (jamais en superposition) : elle ne masque
 * donc jamais le champ.
 *
 * Déclaratif : poser un attribut `data-tt="<clé>"` sur un <label> (ou un titre)
 * et appeler initTooltips(root). L'init est idempotent : il peut être rappelé
 * après chaque rendu dynamique (tours, prestations, fiches rapides).
 */

// --- TEXTES (modifier ICI) --------------------------------------------------
export const TOOLTIPS = {
  // Formulaire principal (en-tête de la lettre).
  date: "Jour du transport.",
  camion: "Véhicule utilisé pour ce transport.",
  client: "Donneur d'ordre : celui qui commande le transport.",
  projet: "Facultatif : chantier ou affaire du client.",
  contact: "Signe les lettres de voiture. Son e-mail est obligatoire.",
  destinataire: "Qui reçoit la marchandise. Son adresse figure obligatoirement sur la lettre.",
  heures: "Heures de travail du chauffeur sur ce transport.",
  prestations: "Ce qui est facturé (régie, heures supplémentaires, astreinte). N'apparaît sur la lettre que si c'est rempli.",

  // Tours (trajets de la journée).
  tours: "Trajets de la journée : chaque tour relie un lieu de chargement à un lieu de déchargement.",
  site_chargement: "Lieu où le chauffeur charge la marchandise.",
  site_dechargement: "Lieu où le chauffeur livre la marchandise.",

  // Ligne d'article d'un tour (champs compacts : textes repris en aria-label).
  ligne_article: "Marchandise transportée sur ce tour.",
  ligne_quantite: "Quantité transportée pour cet article.",
  ligne_unite: "Unité de la quantité (tonne, m³, unité, big bag).",

  // Ligne de prestation (champs compacts : textes repris en aria-label).
  prestation_prestation: "Prestation facturée en plus du transport.",
  prestation_quantite: "Nombre d'unités de cette prestation.",
  prestation_unite: "Unité de la prestation (jour, heure, unité).",
  prestation_materiel: "Matériel utilisé pour la prestation.",

  // Fiches rapides : seulement les champs non évidents.
  qc_alias: "Autre nom pour retrouver la société en recherche.",
  qc_siren: "Numéro d'identification de l'entreprise (9 chiffres).",
  qc_contact_email: "Obligatoire : sert à envoyer la lettre de voiture à signer.",
};

// Champs qui DOIVENT avoir un texte d'aide défini (contrôlé par le test).
export const FORM_FIELD_KEYS = [
  "date", "camion", "client", "projet", "contact", "destinataire", "heures",
  "prestations", "tours", "site_chargement", "site_dechargement",
  "ligne_article", "ligne_quantite", "ligne_unite",
  "prestation_prestation", "prestation_quantite", "prestation_unite", "prestation_materiel",
];

export function tooltipText(key) {
  return TOOLTIPS[key];
}

// --- Mécanique DOM (ignorée côté Node : aucun accès DOM au chargement) -------
let _open = null;      // { btn, bubble } de la bulle ouverte (une seule à la fois)
let _docWired = false;
let _seq = 0;

function closeOpen() {
  if (!_open) return;
  _open.bubble.hidden = true;
  _open.btn.setAttribute("aria-expanded", "false");
  _open.btn.removeAttribute("aria-describedby");
  _open = null;
}

export function closeAllTooltips() {
  closeOpen();
}

function wireDoc() {
  if (_docWired || typeof document === "undefined") return;
  _docWired = true;
  // Toucher ailleurs = fermer (hors icône et hors bulle).
  document.addEventListener("click", (e) => {
    if (!_open) return;
    const t = e.target;
    if (t && t.closest && (t.closest(".tt-btn") || t.closest(".tt-bubble"))) return;
    closeOpen();
  });
  // Échap = fermer + rendre le focus au bouton.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _open) {
      const b = _open.btn;
      closeOpen();
      try { b.focus(); } catch (_) { /* noop */ }
    }
  });
}

const INFO_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

/**
 * Décore tous les [data-tt] présents sous `root` (idempotent).
 * @param {ParentNode} root
 */
export function initTooltips(root) {
  if (typeof document === "undefined") return;
  wireDoc();
  const scope = root || document;
  const els = scope.querySelectorAll ? scope.querySelectorAll("[data-tt]") : [];
  els.forEach((el) => {
    if (el.dataset.ttReady === "1") return;
    const key = el.getAttribute("data-tt");
    const text = TOOLTIPS[key];
    if (!text) return;                       // clé inconnue : on ignore proprement
    el.dataset.ttReady = "1";

    const id = `tt-bubble-${key}-${++_seq}`;
    const labelText = (el.textContent || "").trim() || key;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tt-btn";
    btn.setAttribute("aria-label", `Aide : ${labelText}`);
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = INFO_SVG;

    const bubble = document.createElement("span");
    bubble.className = "tt-bubble";
    bubble.id = id;
    bubble.setAttribute("role", "tooltip");
    bubble.hidden = true;
    bubble.textContent = text;

    // Enveloppe libellé + icône dans une ligne (icône à droite du libellé).
    const row = document.createElement("span");
    row.className = "tt-row";
    el.parentNode.insertBefore(row, el);
    row.appendChild(el);
    row.appendChild(btn);
    // Bulle juste après la ligne : elle pousse le champ vers le bas, sans le couvrir.
    row.parentNode.insertBefore(bubble, row.nextSibling);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = _open && _open.btn === btn;
      closeOpen();
      if (!wasOpen) {
        bubble.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        btn.setAttribute("aria-describedby", id);
        _open = { btn, bubble };
      }
    });
  });
}
