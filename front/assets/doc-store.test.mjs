// Tests « Mes documents » (beta.36) : expiration, chemins, cache hors ligne,
// file d'envoi (réutilise photo-queue.js), purge à la déconnexion.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expiryStatus, daysUntil, docTitle, filePath, thumbOf, isPdfPath, rowOf, sortDocs,
  wantedFiles, syncCache, mergeDocs, purgeLocal, formatDateFr,
} from "./doc-store.js";
import { createPhotoQueue, memoryStore, packBlobs, unpackBlobs } from "./photo-queue.js";

const TODAY = new Date(2026, 10, 27); // 27/11/2026
const D = "11111111-2222-4333-8444-555555555555";
const F = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("statut d'expiration : rouge si expiré, orange si < 60 j, rien sinon", () => {
  assert.equal(expiryStatus(null, TODAY), null);
  assert.equal(expiryStatus("2026-11-26", TODAY), "expired");
  assert.equal(expiryStatus("2026-11-27", TODAY), "soon"); // expire aujourd'hui
  assert.equal(expiryStatus("2027-01-25", TODAY), "soon"); // 59 j
  assert.equal(expiryStatus("2027-01-26", TODAY), "ok"); // 60 j
  assert.equal(daysUntil("2026-12-07", TODAY), 10);
  assert.equal(formatDateFr("2027-01-31"), "31/01/2027");
});

test("titres, chemins et ligne SQL", () => {
  assert.equal(docTitle({ type: "caces", libelle: "R482 cat. A" }), "CACES R482 cat. A");
  assert.equal(docTitle({ type: "autre", libelle: "ADR" }), "ADR");
  assert.equal(docTitle({ type: "permis" }), "Permis de conduire");
  const p = filePath(12, D, F, "jpg");
  assert.equal(p, `u/12/${D}/${F}.jpg`);
  assert.equal(thumbOf(p), `u/12/${D}/${F}.thumb.jpg`);
  assert.equal(thumbOf(filePath(12, D, F, "pdf")), null);
  assert.ok(isPdfPath(filePath(12, D, F, "pdf")));
  assert.deepEqual(rowOf({ id: D, type: "permis", recto_path: p, libelle: "", extra: 1 }), {
    id: D, type: "permis", libelle: null, numero: null, expiration: null, recto_path: p, verso_path: null,
  });
  assert.deepEqual(wantedFiles({ recto_path: p, verso_path: filePath(12, D, F, "pdf") }),
    [p, thumbOf(p), filePath(12, D, F, "pdf")]);
  const s = sortDocs([{ type: "autre", libelle: "Z" }, { type: "caces", libelle: "R489" }, { type: "permis" }]);
  assert.deepEqual(s.map((d) => d.type), ["permis", "caces", "autre"]);
});

test("cache hors ligne : télécharge les manquants, réutilise l'existant, retire les disparus", async () => {
  const cache = memoryStore();
  const fetched = [];
  const fetchFiles = async (paths) => {
    fetched.push(...paths);
    return Object.fromEntries(paths.map((p) => [p, `blob:${p}`]));
  };
  const r1 = { id: "d1", type: "permis", recto_path: "u/1/d1/a.jpg", verso_path: "u/1/d1/b.pdf" };
  const r2 = { id: "d2", type: "caces", recto_path: "u/1/d2/c.jpg" };
  await syncCache({ cache, rows: [r1, r2], owner: "a@k.fr", fetchFiles });
  assert.equal(fetched.length, 5);
  // 2e passage : rien à télécharger ; d2 a disparu côté serveur, d1 a un nouveau recto.
  fetched.length = 0;
  const r1b = { ...r1, recto_path: "u/1/d1/z.jpg" };
  await syncCache({ cache, rows: [r1b], owner: "a@k.fr", fetchFiles });
  assert.deepEqual(fetched.sort(), ["u/1/d1/z.jpg", "u/1/d1/z.thumb.jpg"]);
  const all = await cache.getAll();
  assert.deepEqual(all.map((c) => c.id), ["d1"]);
  assert.deepEqual(Object.keys(all[0].files).sort(), ["u/1/d1/b.pdf", "u/1/d1/z.jpg", "u/1/d1/z.thumb.jpg"]);
  // Autre propriétaire (changement de compte) : le cache précédent est vidé.
  await syncCache({ cache, rows: [], owner: "b@k.fr", fetchFiles });
  assert.equal((await cache.getAll()).length, 0);
});

test("affichage hors ligne : cache + ajouts / modifications / suppressions en file", () => {
  const cached = [
    { id: "d1", owner: "a", row: { id: "d1", type: "permis", recto_path: "r1" }, files: { r1: "B1" } },
    { id: "d2", owner: "a", row: { id: "d2", type: "caces", libelle: "R482", recto_path: "r2" }, files: {} },
    { id: "x", owner: "autre", row: { id: "x", type: "permis", recto_path: "rx" }, files: {} },
  ];
  const ops = [
    { id: "o2", kind: "upsert", docId: "d1", owner: "a", queuedAt: "2", row: { id: "d1", type: "permis", recto_path: "r1", expiration: "2027-01-01" } },
    { id: "o1", kind: "upsert", docId: "d3", owner: "a", queuedAt: "1", row: { id: "d3", type: "fco_fimo", recto_path: "r3" }, files: { r3: "B3" } },
    { id: "o3", kind: "delete", docId: "d2", owner: "a", queuedAt: "3" },
  ];
  const list = mergeDocs(cached, ops, "a");
  assert.deepEqual(list.map((d) => d.id), ["d1", "d3"]);
  assert.equal(list[0].expiration, "2027-01-01");
  assert.equal(list[0].files.r1, "B1");
  assert.ok(list[0].pending && list[1].pending);
  assert.equal(list[1].files.r3, "B3");
});

test("file d'envoi : en attente hors ligne, envoyée au retour du réseau, dans l'ordre", async () => {
  const store = memoryStore();
  let online = false;
  const sent = [];
  const q = createPhotoQueue({
    store,
    upload: async (op) => {
      if (!online) throw Object.assign(new Error("Failed to fetch"), { code: "" });
      sent.push(op.id);
    },
  });
  await q.enqueue({ id: "o1", kind: "upsert", docId: "d1", queuedAt: "1" });
  await q.enqueue({ id: "o2", kind: "delete", docId: "d1", queuedAt: "2" });
  assert.equal((await q.list()).length, 2, "conservées hors ligne");
  online = true;
  await q.flush();
  assert.deepEqual(sent, ["o1", "o2"]);
  assert.equal((await q.list()).length, 0);
});

test("purge à la déconnexion : cache ET file vidés après une dernière tentative d'envoi", async () => {
  const cache = memoryStore();
  const queueStore = memoryStore();
  await cache.put({ id: "d1", owner: "a", row: {}, files: { p: "B" } });
  await queueStore.put({ id: "o1", kind: "upsert" });
  let flushed = false;
  await purgeLocal({ cache, queueStore, flush: async () => { flushed = true; } });
  assert.ok(flushed);
  assert.equal((await cache.getAll()).length, 0);
  assert.equal((await queueStore.getAll()).length, 0);
  // Flush qui ne répond jamais (réseau pendant) : la purge a lieu quand même.
  await queueStore.put({ id: "o2" });
  await purgeLocal({ cache, queueStore, flush: () => new Promise(() => {}), timeoutMs: 20 });
  assert.equal((await queueStore.getAll()).length, 0);
});

test("sérialisation IndexedDB : Blobs (JPEG + PDF) imbriqués, compat beta.35", async () => {
  const pdf = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
  const jpg = new Blob([new Uint8Array([255, 216])], { type: "image/jpeg" });
  const packed = await packBlobs({ id: "o1", files: { a: pdf, b: jpg }, n: 3 });
  assert.ok(packed.files.a.__blob instanceof ArrayBuffer);
  const back = unpackBlobs(packed);
  assert.equal(back.files.a.type, "application/pdf");
  assert.equal(back.files.b.type, "image/jpeg");
  assert.equal(back.n, 3);
  const legacy = unpackBlobs({ id: "p", blob: new Uint8Array([1]).buffer });
  assert.equal(legacy.blob.type, "image/jpeg");
});
