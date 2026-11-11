/* ==========================================================================
   bon.kerlam.fr — application shell (module ES, sans bundler)
   Routeur par hash, appels API, file d'envoi (memoire + IndexedDB),
   indicateur d'enregistrement, mode controle hors ligne.
   ========================================================================== */

'use strict';

/* ------------------------------------------------------------------ *
 * Debug no-op en production (pas de console.log en prod).            *
 * ------------------------------------------------------------------ */
const APP_VERSION = (document.querySelector('meta[name=app-version]')?.content || '').trim();
const IS_DEV = APP_VERSION === '' || APP_VERSION === '__APP_VERSION__' || /dev|local|beta/i.test(APP_VERSION);
const debug = IS_DEV ? (...a) => console.debug('[bon]', ...a) : () => {};

/* ------------------------------------------------------------------ *
 * Petits helpers DOM.                                                *
 * ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ------------------------------------------------------------------ *
 * IndexedDB minimal : file d'envoi + cache local des LV.             *
 * ------------------------------------------------------------------ */
const DB_NAME = 'bon-kerlam';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('lettres')) {
        db.createObjectStore('lettres', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    const out = fn(os);
    tx.oncomplete = () => resolve(out?.result ?? out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const Store = {
  queueAdd: (item) => idbTx('queue', 'readwrite', (os) => os.add({ ...item, ts: Date.now() })),
  queueAll: () => idbTx('queue', 'readonly', (os) => os.getAll()),
  queueDelete: (id) => idbTx('queue', 'readwrite', (os) => os.delete(id)),
  queueCount: () => idbTx('queue', 'readonly', (os) => os.count()),
  lettresPut: (list) => idbTx('lettres', 'readwrite', (os) => { list.forEach((l) => os.put(l)); }),
  lettresAll: () => idbTx('lettres', 'readonly', (os) => os.getAll()),
};

/* ------------------------------------------------------------------ *
 * File d'envoi : etat en memoire + persistance IndexedDB.            *
 * Expose les hooks globaux attendus par app-version.js.             *
 * ------------------------------------------------------------------ */
const Queue = {
  pending: 0,
  async refresh() {
    try { this.pending = await Store.queueCount(); } catch { /* ignore */ }
    UI.reflectSaveState();
    return this.pending;
  },
  async enqueue(payload) {
    await Store.queueAdd(payload);
    await this.refresh();
    UI.setSaveState('saving');
    this.flush();
  },
  async flush() {
    if (!navigator.onLine) { UI.setSaveState('offline'); return; }
    let items = [];
    try { items = await Store.queueAll(); } catch { return; }
    for (const item of items) {
      try {
        const res = await api(item.url, { method: item.method || 'POST', body: item.body });
        if (res && res.ok === false) throw new Error('reject');
        await Store.queueDelete(item.id);
      } catch (e) {
        debug('flush echec, on garde en file', e);
        UI.setSaveState(navigator.onLine ? 'saving' : 'offline');
        await this.refresh();
        return;
      }
    }
    await this.refresh();
    UI.setSaveState(this.pending === 0 ? 'saved' : 'saving');
  },
  isEmpty() { return this.pending === 0; },
};

// Hooks consommes par app-version.js pour differer un rechargement.
window.__bonQueueEmpty = () => Queue.isEmpty();
window.__bonHasFocus = () => {
  const a = document.activeElement;
  return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable));
};

/* ------------------------------------------------------------------ *
 * Couche API. Detecte X-App-Version pour signaler une MAJ.          *
 * ------------------------------------------------------------------ */
async function api(path, { method = 'GET', body = null, raw = false } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body != null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  // Signaler une divergence de version a app-version.js.
  const srvVer = res.headers.get('X-App-Version');
  if (srvVer && APP_VERSION && srvVer !== APP_VERSION && typeof window.__bonOnServerVersion === 'function') {
    window.__bonOnServerVersion(srvVer);
  }
  if (raw) return res;
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('Content-Type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

const Api = {
  version: () => api('/api/version'),
  me: () => api('/api/auth/me'),
  devLogin: (role = 'bureau') => api('/api/auth/dev-login?role=' + encodeURIComponent(role), { method: 'POST' }),
  lettres: () => api('/api/v1/lettres'),
  prefill: (params) => api('/api/v1/prefill' + (params ? '?' + new URLSearchParams(params) : '')),
  sitesListe: () => api('/api/v1/sites-liste'),
  pdfUrl: (id) => `/api/v1/lettres/${encodeURIComponent(id)}/pdf`,
};

/* ------------------------------------------------------------------ *
 * UI : indicateur d'enregistrement, version, undo/redo.             *
 * ------------------------------------------------------------------ */
const UI = {
  _state: 'saved',
  setSaveState(state) {
    this._state = state;
    const map = {
      saved: ['Enregistre', 'saved'],
      saving: ['Envoi en cours', 'saving'],
      offline: ['Hors ligne', 'offline'],
      sent: ['Envoye', 'sent'],
    };
    const [label, cls] = map[state] || map.saved;
    const ind = $('#save-indicator');
    const lbl = $('#save-label');
    if (ind) ind.dataset.state = cls;
    if (lbl) lbl.textContent = label;
  },
  reflectSaveState() {
    if (!navigator.onLine) { this.setSaveState('offline'); return; }
    this.setSaveState(Queue.isEmpty() ? 'saved' : 'saving');
  },
  showVersion() {
    const v = APP_VERSION && APP_VERSION !== '__APP_VERSION__' ? APP_VERSION : 'dev';
    const t = $('#app-version-txt');
    if (t) t.textContent = v;
  },
};

/* Undo/redo : pile simple pour la beta (branchee par les ecrans d'edition). */
const History = {
  past: [], future: [],
  push(cmd) { this.past.push(cmd); this.future.length = 0; this._sync(); },
  undo() { const c = this.past.pop(); if (c) { c.undo?.(); this.future.push(c); } this._sync(); },
  redo() { const c = this.future.pop(); if (c) { c.redo?.(); this.past.push(c); } this._sync(); },
  _sync() {
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = this.past.length === 0;
    if (r) r.disabled = this.future.length === 0;
  },
};
$('#btn-undo')?.addEventListener('click', () => History.undo());
$('#btn-redo')?.addEventListener('click', () => History.redo());

/* ------------------------------------------------------------------ *
 * Rendu du mode controle (mise en page simplifiee facon PDF).       *
 * ------------------------------------------------------------------ */
function renderLettrePreview(lv) {
  const num = lv.numero || lv.id || '—';
  const date = lv.date || lv.created_at || '';
  const client = lv.client || lv.client_nom || '—';
  const chantier = lv.chantier || lv.site || lv.destination || '—';
  const chauffeur = lv.chauffeur || lv.driver || '—';
  const camion = lv.camion || lv.vehicule || '—';
  const lignes = Array.isArray(lv.articles) ? lv.articles : (Array.isArray(lv.lignes) ? lv.lignes : []);
  const rows = lignes.length
    ? lignes.map((a) => `<tr><td>${esc(a.designation || a.libelle || a.article || '')}</td><td class="num">${esc(a.quantite ?? a.qte ?? '')}</td><td>${esc(a.unite || a.unit || '')}</td></tr>`).join('')
    : '<tr><td colspan="3" style="color:#777">Aucun article</td></tr>';
  const statut = lv.statut || lv.status || 'brouillon';
  return `
    <article class="pdf">
      <div class="pdf__head">
        <div><div class="pdf__title">Lettre de voiture</div><div>N&deg; ${esc(num)}</div></div>
        <div class="logo"><span class="logo__ker">KER</span><span class="logo__lam">LAM</span></div>
      </div>
      <dl class="pdf__grid">
        <div><dt>Date</dt><dd class="num">${esc(date)}</dd></div>
        <div><dt>Statut</dt><dd>${esc(statut)}</dd></div>
        <div><dt>Client</dt><dd>${esc(client)}</dd></div>
        <div><dt>Chantier</dt><dd>${esc(chantier)}</dd></div>
        <div><dt>Chauffeur</dt><dd>${esc(chauffeur)}</dd></div>
        <div><dt>Camion</dt><dd>${esc(camion)}</dd></div>
      </dl>
      <table>
        <thead><tr><th>Designation</th><th class="num">Qte</th><th>Unite</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="pdf__sign">
        <div>Signature chauffeur<br>_____________</div>
        <div>Signature client<br>_____________</div>
      </div>
    </article>`;
}

/* ------------------------------------------------------------------ *
 * Vues du routeur.                                                   *
 * ------------------------------------------------------------------ */
const App = { version: null, me: null, lettres: [] };

const setPrimaryAction = (node) => {
  const slot = $('#primary-action-slot');
  if (!slot) return;
  slot.innerHTML = '';
  if (node) slot.appendChild(node);
};

const Views = {
  async aujourdhui(view) {
    setPrimaryAction(el('button', { class: 'btn btn--primary btn--block', onclick: () => { location.hash = '#/lv/nouveau'; } }, 'Nouvelle lettre de voiture'));
    view.innerHTML = '<h1>Aujourd\'hui</h1><p class="loading">Chargement&hellip;</p>';

    // Charger en parallele version + identite + lettres.
    const [verR, meR, lvR] = await Promise.allSettled([Api.version(), Api.me(), Api.lettres()]);
    App.version = verR.status === 'fulfilled' ? verR.value : null;
    App.me = meR.status === 'fulfilled' ? meR.value : null;
    App.lettres = lvR.status === 'fulfilled' ? (Array.isArray(lvR.value) ? lvR.value : (lvR.value?.items || [])) : [];

    // Mettre en cache local pour le mode controle hors ligne.
    if (App.lettres.length) { Store.lettresPut(App.lettres).catch(() => {}); }

    const env = App.version?.environment || App.version?.env || (IS_DEV ? 'dev' : 'production');
    const isProd = /prod/i.test(env);

    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', {}, 'Aujourd\'hui'));

    // Bloc DEV login (masque en production).
    if (!isProd) {
      const box = el('div', { class: 'devbox' });
      box.appendChild(el('div', { class: 'devbox__title' }, 'DEV — environnement ' + esc(env)));
      const row = el('div', { class: 'devbox__row' });
      ['bureau', 'chauffeur', 'admin'].forEach((role) => {
        row.appendChild(el('button', {
          class: 'btn btn--ghost',
          onclick: async (e) => {
            e.target.disabled = true;
            try { await Api.devLogin(role); location.reload(); }
            catch { e.target.disabled = false; alert('Dev login indisponible'); }
          },
        }, 'Login ' + role));
      });
      box.appendChild(row);
      frag.appendChild(box);
    }

    // Identite.
    const who = App.me?.email || App.me?.name || App.me?.user || null;
    frag.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card__title' }, 'Session'),
      el('div', {}, who ? ('Connecte : ' + who) : 'Non connecte'),
    ]));

    // Stats rapides.
    const total = App.lettres.length;
    const count = (pred) => App.lettres.filter(pred).length;
    const signed = count((l) => /sign/i.test(l.statut || l.status || ''));
    const sent = count((l) => /envoy|sent/i.test(l.statut || l.status || ''));
    const draft = total - signed - sent;
    const stats = el('div', { class: 'stats' });
    [['Du jour', total], ['Brouillons', draft], ['Signees', signed], ['Envoyees', sent]].forEach(([lbl, val]) => {
      stats.appendChild(el('div', { class: 'stat' }, [
        el('div', { class: 'stat__val num' }, String(val)),
        el('div', { class: 'stat__lbl' }, lbl),
      ]));
    });
    frag.appendChild(stats);

    // Liste du jour.
    frag.appendChild(el('h2', {}, 'Lettres du jour'));
    frag.appendChild(renderLvList(App.lettres));

    view.innerHTML = '';
    view.appendChild(frag);
  },

  async lv(view) {
    setPrimaryAction(el('button', { class: 'btn btn--primary btn--block', onclick: () => { location.hash = '#/lv/nouveau'; } }, 'Nouvelle LV'));
    view.innerHTML = '<h1>Mes lettres de voiture</h1><p class="loading">Chargement&hellip;</p>';
    let lettres = [];
    try { const r = await Api.lettres(); lettres = Array.isArray(r) ? r : (r?.items || []); }
    catch { lettres = await Store.lettresAll().catch(() => []); }
    if (lettres.length) Store.lettresPut(lettres).catch(() => {});
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', {}, 'Mes lettres de voiture'));
    frag.appendChild(renderLvList(lettres));
    view.innerHTML = '';
    view.appendChild(frag);
  },

  async lvNouveau(view) {
    setPrimaryAction(null);
    view.innerHTML = '<h1>Nouvelle LV</h1><p class="loading">Pre-remplissage&hellip;</p>';
    let prefill = null, sites = [];
    const [p, s] = await Promise.allSettled([Api.prefill(), Api.sitesListe()]);
    prefill = p.status === 'fulfilled' ? p.value : {};
    sites = s.status === 'fulfilled' ? (Array.isArray(s.value) ? s.value : (s.value?.items || [])) : [];

    const form = el('form', { class: 'card', onsubmit: (e) => e.preventDefault() });
    form.appendChild(el('div', { class: 'card__title' }, 'Informations (enregistrement automatique)'));

    const field = (label, name, value = '') => {
      const wrap = el('label', { style: 'display:block;margin-bottom:12px' });
      wrap.appendChild(el('div', { style: 'font-size:.8rem;color:var(--text-soft);margin-bottom:4px' }, label));
      const input = el('input', {
        name, value: value ?? '', class: 'num',
        style: 'width:100%;min-height:48px;padding:0 12px;font-size:16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)',
      });
      // Enregistrement temps reel : chaque champ alimente la file d'envoi.
      input.addEventListener('change', () => {
        Queue.enqueue({ url: '/api/v1/lettres', method: 'POST', body: { field: name, value: input.value, prefill } });
        History.push({ undo() {}, redo() {} });
      });
      wrap.appendChild(input);
      return wrap;
    };

    form.appendChild(field('Client', 'client', prefill?.client));
    form.appendChild(field('Chantier', 'chantier', prefill?.chantier));
    form.appendChild(field('Chauffeur', 'chauffeur', prefill?.chauffeur));
    form.appendChild(field('Camion', 'camion', prefill?.camion));

    // Liste de sites (datalist).
    if (sites.length) {
      const dl = el('datalist', { id: 'sites-list' });
      sites.forEach((site) => dl.appendChild(el('option', { value: site.nom || site.name || site.label || String(site) })));
      form.appendChild(dl);
    }

    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', {}, 'Nouvelle LV'));
    frag.appendChild(form);
    frag.appendChild(el('p', { style: 'color:var(--text-soft);font-size:.85rem' }, 'Les modifications sont enregistrees automatiquement. Aucun bouton Enregistrer.'));
    view.innerHTML = '';
    view.appendChild(frag);
  },

  async controle(view) {
    setPrimaryAction(null);
    view.innerHTML = '<h1>Controle</h1><p class="loading">Preparation&hellip;</p>';
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', {}, 'Mode controle'));
    frag.appendChild(el('p', { style: 'color:var(--text-soft)' }, navigator.onLine
      ? 'En ligne : ouverture du PDF officiel disponible. Rendu local egalement affiche ci-dessous (hors ligne).'
      : 'Hors ligne : rendu local des lettres du jour depuis les donnees enregistrees.'));

    // Source : API si en ligne, sinon cache IndexedDB.
    let lettres = [];
    if (navigator.onLine) {
      try { const r = await Api.lettres(); lettres = Array.isArray(r) ? r : (r?.items || []); }
      catch { lettres = await Store.lettresAll().catch(() => []); }
    } else {
      lettres = await Store.lettresAll().catch(() => []);
    }

    if (!lettres.length) {
      frag.appendChild(el('p', { class: 'empty' }, 'Aucune lettre de voiture disponible.'));
    } else {
      lettres.forEach((lv) => {
        const block = el('div', {});
        block.innerHTML = renderLettrePreview(lv);
        if (navigator.onLine && (lv.id != null)) {
          block.appendChild(el('a', { class: 'btn btn--ghost', href: Api.pdfUrl(lv.id), target: '_blank', rel: 'noopener' }, 'Ouvrir le PDF officiel'));
        }
        frag.appendChild(block);
      });
    }
    view.innerHTML = '';
    view.appendChild(frag);
  },

  placeholder(view, title) {
    setPrimaryAction(null);
    view.innerHTML = '';
    view.appendChild(el('h1', {}, title));
    view.appendChild(el('p', { class: 'empty' }, 'Ecran a venir (beta).'));
  },
};

function renderLvList(lettres) {
  if (!lettres.length) return el('p', { class: 'empty' }, 'Aucune lettre de voiture.');
  const ul = el('ul', { class: 'lv-list' });
  lettres.forEach((lv) => {
    const statut = (lv.statut || lv.status || 'brouillon').toLowerCase();
    const badgeCls = /sign/.test(statut) ? 'signed' : /envoy|sent/.test(statut) ? 'sent' : /alert|erreur/.test(statut) ? 'alert' : 'draft';
    const li = el('li', { class: 'lv-card' }, [
      el('div', { class: 'lv-card__main' }, [
        el('div', { class: 'lv-card__num num' }, 'N° ' + esc(lv.numero || lv.id || '—')),
        el('div', { class: 'lv-card__sub' }, esc((lv.client || lv.client_nom || '') + ' · ' + (lv.chantier || lv.site || ''))),
      ]),
      el('span', { class: 'badge badge--' + badgeCls }, esc(lv.statut || lv.status || 'brouillon')),
    ]);
    li.addEventListener('click', () => { if (lv.id != null) location.hash = '#/lv/' + encodeURIComponent(lv.id); });
    ul.appendChild(li);
  });
  return ul;
}

/* ------------------------------------------------------------------ *
 * Routeur par hash.                                                  *
 * ------------------------------------------------------------------ */
const routes = [
  { re: /^#?\/?$/, run: (v) => Views.aujourdhui(v) },
  { re: /^#\/aujourdhui$/, run: (v) => Views.aujourdhui(v) },
  { re: /^#\/lv\/nouveau$/, run: (v) => Views.lvNouveau(v) },
  { re: /^#\/lv(\/.*)?$/, run: (v) => Views.lv(v) },
  { re: /^#\/controle$/, run: (v) => Views.controle(v) },
  { re: /^#\/planning$/, run: (v) => Views.placeholder(v, 'Planning') },
  { re: /^#\/projets$/, run: (v) => Views.placeholder(v, 'Projets') },
  { re: /^#\/clients$/, run: (v) => Views.placeholder(v, 'Clients') },
  { re: /^#\/sites$/, run: (v) => Views.placeholder(v, 'Sites') },
  { re: /^#\/camions$/, run: (v) => Views.placeholder(v, 'Camions') },
  { re: /^#\/chauffeurs$/, run: (v) => Views.placeholder(v, 'Chauffeurs') },
  { re: /^#\/articles$/, run: (v) => Views.placeholder(v, 'Articles') },
  { re: /^#\/reglages$/, run: (v) => Views.placeholder(v, 'Reglages') },
];

async function router() {
  const hash = location.hash || '#/aujourdhui';
  const view = $('#view');
  highlightNav(hash);
  const route = routes.find((r) => r.re.test(hash)) || routes[0];
  try {
    await route.run(view);
  } catch (e) {
    debug('erreur vue', e);
    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Erreur'));
    view.appendChild(el('p', { class: 'error' }, 'Impossible de charger cet ecran. Verifiez la connexion.'));
  }
  view.focus?.();
}

function highlightNav(hash) {
  const base = '#/' + (hash.replace(/^#\//, '').split('/')[0] || 'aujourdhui');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const href = a.getAttribute('href');
    const match = href === base || (base === '#/aujourdhui' && href === '#/aujourdhui');
    a.classList.toggle('is-active', match);
  });
}

/* ------------------------------------------------------------------ *
 * Enregistrement du service worker.                                  *
 * ------------------------------------------------------------------ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js?v=' + encodeURIComponent(APP_VERSION)).catch((e) => debug('SW ko', e));
}

/* ------------------------------------------------------------------ *
 * Reseau : au retour en ligne, vider la file.                        *
 * ------------------------------------------------------------------ */
window.addEventListener('online', () => { UI.reflectSaveState(); Queue.flush(); });
window.addEventListener('offline', () => UI.setSaveState('offline'));

/* ------------------------------------------------------------------ *
 * Demarrage.                                                         *
 * ------------------------------------------------------------------ */
function boot() {
  UI.showVersion();
  UI.reflectSaveState();
  Queue.refresh().then(() => Queue.flush());
  window.addEventListener('hashchange', router);
  router();
  registerSW();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { Api, Queue, Store, router };
