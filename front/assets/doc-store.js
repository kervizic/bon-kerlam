/* doc-store.js - logique PURE de « Mes documents » (beta.36).
 *
 *  - types de documents, libellés, statut d'expiration (affichage seul : aucune
 *    notification, aucun rappel) ;
 *  - chemins storage u/<owner_id>/<doc_id>/<file_id>.jpg|pdf (+ .thumb.jpg) ;
 *  - cache local (documents du propriétaire uniquement, pour les montrer lors
 *    d'un contrôle sans réseau) : synchronisation avec la liste serveur, fusion
 *    avec les opérations en file (ajouts / modifications / suppressions hors
 *    ligne), purge complète à la déconnexion.
 * Magasins injectés ({ put, get, delete, getAll, clear }) : testable sous Node.
 */

export const BUCKET = "documents-chauffeurs";
export const SOON_DAYS = 60;

export const DOC_TYPES = [
  { value: "permis", label: "Permis de conduire" },
  { value: "carte_conducteur", label: "Carte conducteur" },
  { value: "fco_fimo", label: "FCO / FIMO" },
  { value: "caces", label: "CACES" },
  { value: "autre", label: "Autre" },
];

const TYPE_RANK = Object.fromEntries(DOC_TYPES.map((t, i) => [t.value, i]));

export function typeLabel(type) {
  const t = DOC_TYPES.find((x) => x.value === type);
  return t ? t.label : "Document";
}

/** Titre de carte : « CACES R482 », libellé libre pour « Autre ». */
export function docTitle(doc) {
  const lib = (doc && doc.libelle ? String(doc.libelle).trim() : "");
  if (doc && doc.type === "autre") return lib || "Autre document";
  return lib ? `${typeLabel(doc.type)} ${lib}` : typeLabel(doc && doc.type);
}

/** Jours entiers jusqu'à l'échéance (date locale). */
export function daysUntil(iso, today = new Date()) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - t0) / 86400000);
}

/** "expired" (dépassée), "soon" (< 60 j), "ok", ou null (pas de date). */
export function expiryStatus(iso, today = new Date(), soonDays = SOON_DAYS) {
  const j = daysUntil(iso, today);
  if (j == null) return null;
  if (j < 0) return "expired";
  if (j < soonDays) return "soon";
  return "ok";
}

export function formatDateFr(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

/* ----------------------------------------------------------- chemins storage -- */
export function filePath(ownerId, docId, fileId, ext) {
  return `u/${ownerId}/${docId}/${fileId}.${ext === "pdf" ? "pdf" : "jpg"}`;
}
export function thumbOf(path) {
  return path && /\.jpg$/.test(path) ? path.replace(/\.jpg$/, ".thumb.jpg") : null;
}
export function isPdfPath(path) {
  return /\.pdf$/.test(String(path || ""));
}

/** Ligne SQL (api.documents_chauffeur) à partir d'un document local. */
export function rowOf(doc) {
  return {
    id: doc.id,
    type: doc.type,
    libelle: doc.libelle || null,
    numero: doc.numero || null,
    expiration: doc.expiration || null,
    recto_path: doc.recto_path,
    verso_path: doc.verso_path || null,
  };
}

export function sortDocs(docs) {
  return (docs || []).slice().sort((a, b) =>
    (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9)
    || docTitle(a).localeCompare(docTitle(b), "fr")
    || String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

/* -------------------------------------------------------------- cache local -- */
/** Fichiers à conserver hors ligne pour un document : image + miniature, ou PDF. */
export function wantedFiles(row) {
  const out = [];
  for (const side of ["recto", "verso"]) {
    const p = row[`${side}_path`];
    if (!p) continue;
    out.push(p);
    const t = thumbOf(p);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Aligne le cache local sur la liste serveur `rows` (documents du propriétaire
 * connecté `owner`). Télécharge seulement les fichiers manquants (fetchFiles
 * renvoie { chemin: Blob }), retire les documents disparus ou d'un autre
 * propriétaire. Renvoie le nombre de documents en cache.
 */
export async function syncCache({ cache, rows, owner, fetchFiles }) {
  const existing = await cache.getAll();
  const ids = new Set(rows.map((r) => r.id));
  for (const e of existing) {
    if (e.owner !== owner || !ids.has(e.id)) await cache.delete(e.id);
  }
  let n = 0;
  for (const row of rows) {
    const prev = existing.find((e) => e.id === row.id && e.owner === owner);
    const files = {};
    const missing = [];
    for (const p of wantedFiles(row)) {
      if (prev && prev.files && prev.files[p]) files[p] = prev.files[p];
      else missing.push(p);
    }
    if (missing.length) {
      try {
        Object.assign(files, (await fetchFiles(missing)) || {});
      } catch (e) {
        /* réseau coupé en cours : on garde ce qu'on a */
      }
    }
    await cache.put({ id: row.id, owner, row, files });
    n++;
  }
  return n;
}

/**
 * Liste à afficher : documents en cache (ou serveur) + opérations en file
 * (ajouts/modifications appliqués, suppressions retirées), triés.
 * Chaque élément : { ...row, files: {chemin: Blob}, pending: bool }.
 */
export function mergeDocs(cached, ops, owner) {
  const map = new Map();
  for (const c of cached || []) {
    if (owner != null && c.owner !== owner) continue;
    map.set(c.id, { ...c.row, files: { ...(c.files || {}) }, pending: false });
  }
  const ordered = (ops || []).slice().sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
  for (const op of ordered) {
    if (owner != null && op.owner && op.owner !== owner) continue;
    if (op.kind === "delete") { map.delete(op.docId); continue; }
    const prev = map.get(op.docId);
    map.set(op.docId, {
      ...(prev || {}),
      ...op.row,
      files: { ...(prev ? prev.files : {}), ...(op.files || {}) },
      pending: true,
    });
  }
  return sortDocs(Array.from(map.values()));
}

/**
 * Purge à la déconnexion (cf. beta.31.2 pour les PDF) : vide le cache des
 * documents ET la file d'envoi (ces données sont personnelles : rien ne doit
 * rester sur l'appareil pour l'utilisateur suivant). Tente d'abord un dernier
 * envoi (flush) borné par `timeoutMs` pour ne pas perdre un ajout récent.
 */
export async function purgeLocal({ cache, queueStore, flush = null, timeoutMs = 4000 }) {
  if (flush) {
    try {
      await Promise.race([flush(), new Promise((r) => setTimeout(r, timeoutMs))]);
    } catch (e) {
      /* hors ligne : tant pis, on purge quand même */
    }
  }
  await Promise.allSettled([cache.clear(), queueStore.clear()]);
}
