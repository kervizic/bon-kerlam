/* photo-queue.js — file d'envoi des photos de ligne (beta.35).
 *
 * TOUTE photo passe par cette file (en ligne comme hors ligne) : elle est
 * d'abord conservée localement (IndexedDB), affichée tout de suite avec un
 * indicateur « en attente », puis envoyée dès que possible (immédiatement si le
 * réseau est là, sinon au retour du réseau). L'envoi est IDEMPOTENT : l'id de la
 * photo (UUID) est aussi son nom de fichier ; un doublon (objet ou ligne déjà
 * présent) est traité comme un succès. Une erreur DÉFINITIVE (droits, plafond,
 * ligne supprimée) retire la photo de la file ; une erreur réseau la conserve.
 *
 * Aucune dépendance DOM hors `idbStore` : testable sous Node (photo-queue.test.mjs).
 */

export const MAX_PER_TYPE = 4;
export const BUCKET = "photos-lignes";

export function photoPaths(lvId, ligneId, id) {
  const path = `lv/${lvId}/ligne/${ligneId}/${id}.jpg`;
  return { path, thumbPath: thumbPathOf(path) };
}

export function thumbPathOf(path) {
  return String(path).replace(/\.jpg$/, ".thumb.jpg");
}

/** Nombre de photos d'un type sur une ligne (photos en base + en attente). */
export function countByType(photos, ligneId, type) {
  return (photos || []).filter((p) => String(p.ligne_id) === String(ligneId) && p.type === type).length;
}

export function canAdd(photos, ligneId, type) {
  return countByType(photos, ligneId, type) < MAX_PER_TYPE;
}

/** Ordre d'affichage : Avant puis Après, chacun du plus ancien au plus récent. */
export function sortPhotos(photos) {
  const rank = (t) => (t === "avant" ? 0 : 1);
  return (photos || []).slice().sort((a, b) =>
    rank(a.type) - rank(b.type) || String(a.taken_at).localeCompare(String(b.taken_at)));
}

export function isDuplicate(err) {
  if (!err) return false;
  const code = String(err.code || "");
  const status = Number(err.status || err.statusCode || 0);
  return code === "23505" || status === 409 || /duplicate|already exists/i.test(String(err.message || err.error || ""));
}

/** Erreur définitive (rejouer ne servirait à rien) vs transitoire (réseau). */
export function isPermanentError(err) {
  if (!err) return false;
  if (isDuplicate(err)) return false;
  const code = String(err.code || "");
  // 42501 RLS/droits, 23514 plafond/cohérence, 23503 ligne/lettre supprimée, 22xxx données.
  if (/^(42501|23514|23503|23502|22)/.test(code)) return true;
  const status = Number(err.status || err.statusCode || 0);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Ligne SQL (bon.ligne_photos) d'un élément de file. */
export function rowOf(item) {
  return {
    id: item.id,
    ligne_id: item.ligneId,
    lv_id: item.lvId,
    tour_id: item.tourId,
    type: item.type,
    taken_at: item.takenAt,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    accuracy_m: item.accuracy ?? null,
    storage_path: photoPaths(item.lvId, item.ligneId, item.id).path,
  };
}

/** Magasin en mémoire (tests, mode démo). */
export function memoryStore() {
  const m = new Map();
  return {
    async put(item) { m.set(item.id, item); },
    async delete(id) { m.delete(id); },
    async get(id) { return m.get(id) || null; },
    async getAll() { return Array.from(m.values()); },
    async clear() { m.clear(); },
  };
}

/**
 * File d'envoi. `upload(item)` doit lever en cas d'échec (erreur portant
 * code/status). `onChange()` est appelé à chaque évolution (ajout, envoi,
 * abandon) ; `onDrop(item, err)` sur abandon définitif.
 */
export function createPhotoQueue({ store, upload, onChange = () => {}, onDrop = () => {} }) {
  let running = null;
  let again = false; // élément ajouté pendant un envoi : relance immédiate

  async function runOnce() {
    const items = (await store.getAll()).sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
    let sent = 0;
    for (const item of items) {
      try {
        await upload(item);
        await store.delete(item.id);
        sent += 1;
        onChange({ sent: item });
      } catch (err) {
        if (isPermanentError(err)) {
          await store.delete(item.id);
          onDrop(item, err);
          onChange({ dropped: item });
          continue;
        }
        break; // réseau absent : on réessaiera au retour du réseau
      }
    }
    return sent;
  }

  return {
    async enqueue(item) {
      await store.put({ queuedAt: new Date().toISOString(), ...item });
      onChange({ queued: item });
      return this.flush();
    },
    /** Envoie ce qui est en file ; un seul envoi à la fois (appels concurrents mutualisés). */
    flush() {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        let sent = 0;
        do {
          again = false;
          sent += await runOnce();
        } while (again);
        return sent;
      })().finally(() => { running = null; });
      return running;
    },
    async list() { return store.getAll(); },
    async remove(id) { await store.delete(id); onChange({ removed: id }); },
  };
}

/* --------------------------------------------------------- IndexedDB (nav.) -- */
// Les Blobs sont stockés en ArrayBuffer (plus robuste sur Safari iOS), avec leur
// type MIME (beta.36 : PDF des documents) ; y compris dans un sous-objet `files`.
// Rétro-compatible : un ArrayBuffer nu (file beta.35) est relu en image/jpeg.
const isBlob = (v) => v && typeof v.arrayBuffer === "function" && typeof v.type === "string";

export async function packBlobs(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (isBlob(v)) out[k] = { __blob: await v.arrayBuffer(), type: v.type || "image/jpeg" };
    else if (k === "files" && v && typeof v === "object") out[k] = await packBlobs(v);
    else out[k] = v;
  }
  return out;
}

export function unpackBlobs(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && v.__blob instanceof ArrayBuffer) out[k] = new Blob([v.__blob], { type: v.type || "image/jpeg" });
    else if (v instanceof ArrayBuffer) out[k] = new Blob([v], { type: "image/jpeg" });
    else if (k === "files" && v && typeof v === "object") out[k] = unpackBlobs(v);
    else out[k] = v;
  }
  return out;
}

export function idbStore(dbName = "bon-photos", storeName = "queue") {
  let dbp = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(storeName, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  };
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const r = fn(t.objectStore(storeName));
      t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    async put(item) {
      const rec = await packBlobs(item);
      await tx("readwrite", (s) => s.put(rec));
    },
    async get(id) {
      const r = await tx("readonly", (s) => s.get(id));
      return r ? unpackBlobs(r) : null;
    },
    async delete(id) { await tx("readwrite", (s) => s.delete(id)); },
    async getAll() {
      const rows = (await tx("readonly", (s) => s.getAll())) || [];
      return rows.map(unpackBlobs);
    },
    async clear() { await tx("readwrite", (s) => s.clear()); },
  };
}
