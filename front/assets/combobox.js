/* combobox.js — champ de recherche (combobox) façon Odoo / Notion / Linear,
 * greffé SUR un <select> natif existant qui reste la source de vérité.
 *
 * Pourquoi greffer sur le <select> plutôt que le remplacer : tout le reste de
 * app.js lit `select.value`, écoute l'événement `change` (autosave champ par
 * champ) et compte sur la présence du <select> dans le formulaire. Le combobox
 * ne fait que PILOTER ce <select> caché : il écrit sa valeur et déclenche
 * `change`. Aucun appelant existant n'a besoin de changer.
 *
 * Comportement (cf. cahier des charges beta.17) :
 *  - saisie -> la liste s'ouvre juste sous le champ et filtre en direct,
 *    insensible à la casse ET aux accents, sur le libellé ET un alias éventuel
 *    (data-alias sur l'option). Le texte trouvé est mis en surbrillance.
 *  - champ vide au focus -> récents d'abord (localStorage par chauffeur), puis
 *    le reste par ordre alphabétique.
 *  - dernière ligne « + Créer "texte" » (si onCreate fourni).
 *  - croix pour vider, crayon pour éditer la fiche (si onEdit fourni).
 *  - ARIA combobox/listbox, pas de zoom iOS (font-size >= 16px géré en CSS).
 *
 * Les fonctions pures (normalizeText, filterItems, orderWithRecents,
 * highlightMatch, recents*) sont exportées et testées par combobox.test.mjs.
 */

/* ----------------------------------------------------------------- Pur / testable */

// Minuscules + suppression des accents (NFD) : « Évacuation » -> « evacuation ».
export function normalizeText(s) {
  return (s == null ? "" : String(s))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Carte caractère par caractère : chaîne normalisée + index d'origine de chaque
// caractère normalisé (un « é » -> « e », les diacritiques disparaissent). Sert à
// reporter une correspondance trouvée sur le normalisé vers le libellé original.
function normMap(str) {
  const s = str == null ? "" : String(str);
  let norm = "";
  const starts = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (let k = 0; k < n.length; k++) {
      norm += n[k];
      starts.push(i);
    }
  }
  return { norm, starts };
}

// item = { value, label, alias }. Filtre sur libellé OU alias (normalisés).
export function filterItems(items, query) {
  const q = normalizeText(query);
  if (!q) return items.slice();
  return items.filter(
    (it) => normalizeText(it.label).includes(q) || normalizeText(it.alias).includes(q)
  );
}

// Récents (valeurs) d'abord — dans l'ordre des récents — puis le reste en
// alphabétique français. Un récent absent de `items` est ignoré.
export function orderWithRecents(items, recents) {
  const order = (recents || []).map(String);
  const inR = [];
  const rest = [];
  for (const it of items) {
    if (order.includes(String(it.value))) inR.push(it);
    else rest.push(it);
  }
  inR.sort((a, b) => order.indexOf(String(a.value)) - order.indexOf(String(b.value)));
  rest.sort((a, b) => String(a.label).localeCompare(String(b.label), "fr", { sensitivity: "base" }));
  return inR.concat(rest);
}

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// HTML du libellé avec <mark> autour de la portion correspondant à la requête
// (sur le libellé ; une correspondance uniquement via l'alias ne surligne rien).
export function highlightMatch(label, query) {
  const text = label == null ? "" : String(label);
  const q = normalizeText(query);
  if (!q) return escapeHtml(text);
  const { norm, starts } = normMap(text);
  const idx = norm.indexOf(q);
  if (idx < 0) return escapeHtml(text);
  const oStart = starts[idx];
  const oEnd = starts[idx + q.length - 1] + 1;
  return (
    escapeHtml(text.slice(0, oStart)) +
    "<mark>" + escapeHtml(text.slice(oStart, oEnd)) + "</mark>" +
    escapeHtml(text.slice(oEnd))
  );
}

/* ---------------------------------------------------------------- Récents (MRU) */

export function recentsKey(entity, driverId) {
  return `bon_recents_${entity}_${driverId == null ? "anon" : driverId}`;
}

export function getRecents(entity, driverId, storage) {
  const store = storage || safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(recentsKey(entity, driverId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) {
    return [];
  }
}

export function pushRecent(entity, driverId, value, max = 5, storage) {
  const store = storage || safeStorage();
  if (value == null || value === "") return getRecents(entity, driverId, store);
  let arr = getRecents(entity, driverId, store).filter((v) => v !== String(value));
  arr.unshift(String(value));
  arr = arr.slice(0, max);
  if (store) {
    try {
      store.setItem(recentsKey(entity, driverId), JSON.stringify(arr));
    } catch (e) {
      /* quota / indispo : on ignore */
    }
  }
  return arr;
}

function safeStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/* ----------------------------------------------------------------- Composant DOM */

let CB_SEQ = 0;

// Lit les options du <select> (hors placeholder value="") en items combobox.
function readItems(select) {
  const items = [];
  for (const opt of Array.from(select.options)) {
    if (opt.value === "") continue;
    items.push({ value: opt.value, label: opt.textContent, alias: opt.dataset.alias || "" });
  }
  return items;
}

function labelForValue(select, value) {
  for (const opt of Array.from(select.options)) {
    if (opt.value === String(value)) return opt.textContent;
  }
  return "";
}

/* Greffe un combobox sur `select`. Options :
 *   entity      string  — clé des récents (ex. "client").
 *   driverId    () => id — identité pour les récents (par chauffeur).
 *   placeholder string
 *   onCreate    async (text) => ({ value, label }) | null — crée une fiche.
 *   onEdit      (value) => void — ouvre la fiche de modification.
 *   canEdit     (value) => boolean — crayon visible si vrai (défaut: onEdit présent).
 * Renvoie une instance { refresh, destroy, open, close, el }.
 */
export function enhanceSelect(select, opts = {}) {
  if (!select || select._cb) return select && select._cb;
  const id = "cb" + ++CB_SEQ;
  const listId = id + "-list";

  select.classList.add("cb-native");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");

  const wrap = document.createElement("div");
  wrap.className = "combobox";
  if (opts.wrapClass) wrap.classList.add(opts.wrapClass);
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const inputWrap = document.createElement("div");
  inputWrap.className = "cb-field";
  wrap.appendChild(inputWrap);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cb-input";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.placeholder = opts.placeholder || "Choisir ou taper…";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  const labelId = select.getAttribute("aria-labelledby");
  if (labelId) input.setAttribute("aria-labelledby", labelId);
  // Reporte un éventuel <label for="selectId"> sur l'input.
  const nativeLabel = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
  if (nativeLabel) input.setAttribute("aria-label", nativeLabel.textContent.trim());
  inputWrap.appendChild(input);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "cb-edit";
  editBtn.tabIndex = -1;
  editBtn.setAttribute("aria-label", "Modifier la fiche");
  editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  editBtn.hidden = true;
  inputWrap.appendChild(editBtn);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "cb-clear";
  clearBtn.tabIndex = -1;
  clearBtn.setAttribute("aria-label", "Vider");
  clearBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  clearBtn.hidden = true;
  inputWrap.appendChild(clearBtn);

  const caret = document.createElement("span");
  caret.className = "cb-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  inputWrap.appendChild(caret);

  const list = document.createElement("div");
  list.className = "cb-list";
  list.id = listId;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.appendChild(list);

  let open = false;
  let activeIndex = -1;
  let rows = []; // { value, label, create } alignés sur les .cb-option du DOM

  function driverId() {
    try {
      return typeof opts.driverId === "function" ? opts.driverId() : opts.driverId;
    } catch (e) {
      return null;
    }
  }

  function syncDisplay() {
    const v = select.value;
    if (v) {
      input.value = labelForValue(select, v);
      clearBtn.hidden = false;
      const editable = opts.onEdit && (opts.canEdit ? opts.canEdit(v) : true);
      editBtn.hidden = !editable;
    } else {
      input.value = "";
      clearBtn.hidden = true;
      editBtn.hidden = true;
    }
  }

  function render(query) {
    const q = query == null ? input.value : query;
    const all = readItems(select);
    let items = filterItems(all, q);
    if (!normalizeText(q)) {
      items = orderWithRecents(items, getRecents(opts.entity, driverId()));
    } else {
      items.sort((a, b) =>
        String(a.label).localeCompare(String(b.label), "fr", { sensitivity: "base" })
      );
    }
    rows = [];
    list.innerHTML = "";

    for (const it of items) {
      const row = document.createElement("div");
      row.className = "cb-option";
      row.setAttribute("role", "option");
      row.id = id + "-opt-" + rows.length;
      if (String(it.value) === String(select.value)) row.setAttribute("aria-selected", "true");
      row.innerHTML = highlightMatch(it.label, q);
      const value = it.value;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(value);
      });
      list.appendChild(row);
      rows.push({ value, create: false });
    }

    // Ligne « + Créer » TOUJOURS proposée quand la création est possible (même
    // liste vide / champ vide) : « + Créer <libellé> » à vide, « + Créer « texte » »
    // dès qu'on tape. Masquée uniquement si le texte correspond EXACTEMENT à une
    // fiche existante (éviter un doublon).
    const typed = (q || "").trim();
    const exact = typed && all.some((it) => normalizeText(it.label) === normalizeText(typed));
    if (opts.onCreate && !exact) {
      const row = document.createElement("div");
      row.className = "cb-option cb-create";
      row.setAttribute("role", "option");
      row.id = id + "-opt-" + rows.length;
      const createLabel = opts.createLabel || "une fiche";
      row.innerHTML = typed
        ? '<span class="cb-create-plus" aria-hidden="true">+</span> Créer « ' + escapeHtml(typed) + " »"
        : '<span class="cb-create-plus" aria-hidden="true">+</span> Créer ' + escapeHtml(createLabel);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        void create(typed);
      });
      list.appendChild(row);
      rows.push({ value: null, create: true, text: typed });
    }

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "cb-empty";
      empty.textContent = "Aucun résultat";
      list.appendChild(empty);
    }
    activeIndex = -1;
    updateActive();
  }

  function updateActive() {
    const nodes = list.querySelectorAll(".cb-option");
    nodes.forEach((n, i) => n.classList.toggle("is-active", i === activeIndex));
    if (activeIndex >= 0 && nodes[activeIndex]) {
      input.setAttribute("aria-activedescendant", nodes[activeIndex].id);
      nodes[activeIndex].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function openList() {
    if (open) return;
    open = true;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    wrap.classList.add("is-open");
    render("");
    // iOS : garder le champ visible au-dessus du clavier.
    try {
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (e) {
      /* noop */
    }
  }

  function closeList() {
    if (!open) return;
    open = false;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    wrap.classList.remove("is-open");
    activeIndex = -1;
    syncDisplay(); // rétablit le libellé si l'utilisateur avait tapé sans choisir
  }

  function choose(value) {
    select.value = String(value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    pushRecent(opts.entity, driverId(), value);
    syncDisplay();
    closeList();
  }

  async function create(text) {
    if (!opts.onCreate) return;
    try {
      const created = await opts.onCreate(text);
      if (created && created.value != null) {
        ensureOption(select, created.value, created.label != null ? created.label : text, created.alias);
        choose(created.value);
      } else {
        closeList();
      }
    } catch (e) {
      closeList();
    }
  }

  // Événements -------------------------------------------------------------
  input.addEventListener("focus", openList);
  input.addEventListener("click", openList);
  input.addEventListener("input", () => {
    if (!open) openList();
    render(input.value);
  });
  input.addEventListener("keydown", (e) => {
    const nodes = list.querySelectorAll(".cb-option");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openList();
      activeIndex = Math.min(activeIndex + 1, nodes.length - 1);
      updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && rows[activeIndex]) {
        e.preventDefault();
        const r = rows[activeIndex];
        if (r.create) void create(r.text);
        else choose(r.value);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        closeList();
      }
    }
  });

  clearBtn.addEventListener("click", () => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncDisplay();
    input.focus();
    openList();
  });

  editBtn.addEventListener("click", () => {
    if (opts.onEdit && select.value) opts.onEdit(select.value);
  });

  function onDocPointer(e) {
    if (!wrap.contains(e.target)) closeList();
  }
  document.addEventListener("pointerdown", onDocPointer);

  const instance = {
    el: wrap,
    refresh() {
      syncDisplay();
      if (open) render(input.value);
    },
    open: openList,
    close: closeList,
    destroy() {
      document.removeEventListener("pointerdown", onDocPointer);
      wrap.parentNode.insertBefore(select, wrap);
      select.classList.remove("cb-native");
      select.removeAttribute("tabindex");
      select.removeAttribute("aria-hidden");
      delete select._cb;
      wrap.remove();
    },
  };
  select._cb = instance;
  syncDisplay();
  return instance;
}

// Ajoute (si absente) une option au <select> et renvoie l'élément option.
export function ensureOption(select, value, label, alias) {
  for (const opt of Array.from(select.options)) {
    if (opt.value === String(value)) {
      opt.textContent = label;
      if (alias != null) opt.dataset.alias = alias;
      return opt;
    }
  }
  const opt = document.createElement("option");
  opt.value = String(value);
  opt.textContent = label;
  if (alias != null) opt.dataset.alias = alias;
  select.appendChild(opt);
  return opt;
}

// Raccourci : rafraîchit le combobox greffé sur un <select> (après set value
// programmatique ou repopulation des options).
export function refreshCombobox(select) {
  if (select && select._cb) select._cb.refresh();
}
