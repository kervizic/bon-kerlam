/* photo-queue.test.mjs — file d'envoi hors ligne des photos de ligne (beta.35). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createPhotoQueue, memoryStore, photoPaths, thumbPathOf, canAdd, countByType,
  isPermanentError, isDuplicate, rowOf, sortPhotos, MAX_PER_TYPE,
} from "./photo-queue.js";

const item = (id, extra = {}) => ({
  id, lvId: 12, tourId: 34, ligneId: 56, type: "avant", takenAt: "2026-11-27T10:00:00Z",
  lat: 48.8, lng: 2.3, accuracy: 9, blob: "B", thumb: "T", ...extra,
});
const netErr = () => Object.assign(new Error("TypeError: Failed to fetch"), { code: "" });

test("chemins storage : lv/<lv>/ligne/<ligne>/<uuid>.jpg + miniature", () => {
  const p = photoPaths(12, 56, "0f8fad5b-d9cb-469f-a165-70867728950e");
  assert.equal(p.path, "lv/12/ligne/56/0f8fad5b-d9cb-469f-a165-70867728950e.jpg");
  assert.equal(p.thumbPath, "lv/12/ligne/56/0f8fad5b-d9cb-469f-a165-70867728950e.thumb.jpg");
  assert.equal(thumbPathOf("a/b.jpg"), "a/b.thumb.jpg");
});

test("plafond : 4 photos par type et par ligne", () => {
  assert.equal(MAX_PER_TYPE, 4);
  const photos = [1, 2, 3, 4].map((i) => ({ id: i, ligne_id: 56, type: "avant" }));
  assert.equal(countByType(photos, "56", "avant"), 4);
  assert.equal(canAdd(photos, 56, "avant"), false);
  assert.equal(canAdd(photos, 56, "apres"), true);
  assert.equal(canAdd(photos, 57, "avant"), true);
});

test("rowOf : ligne SQL conforme", () => {
  const r = rowOf(item("u1"));
  assert.deepEqual(r, {
    id: "u1", ligne_id: 56, lv_id: 12, tour_id: 34, type: "avant", taken_at: "2026-11-27T10:00:00Z",
    lat: 48.8, lng: 2.3, accuracy_m: 9, storage_path: "lv/12/ligne/56/u1.jpg",
  });
  assert.equal(rowOf(item("u2", { lat: undefined, lng: undefined, accuracy: undefined })).lat, null);
});

test("classification des erreurs", () => {
  assert.equal(isPermanentError(netErr()), false);
  assert.equal(isPermanentError({ code: "42501" }), true);
  assert.equal(isPermanentError({ code: "23514", message: "Maximum 4 photos" }), true);
  assert.equal(isPermanentError({ code: "23503" }), true);
  assert.equal(isPermanentError({ status: 403 }), true);
  assert.equal(isPermanentError({ statusCode: "400" }), true);
  assert.equal(isPermanentError({ status: 429 }), false);
  assert.equal(isPermanentError({ status: 503 }), false);
  assert.equal(isDuplicate({ code: "23505" }), true);
  assert.equal(isDuplicate({ statusCode: "409", message: "The resource already exists" }), true);
  assert.equal(isPermanentError({ code: "23505" }), false);
});

test("hors ligne : la photo reste en file, puis part au retour du réseau", async () => {
  let online = false;
  const sent = [];
  const store = memoryStore();
  const q = createPhotoQueue({
    store,
    upload: async (it) => { if (!online) throw netErr(); sent.push(it.id); },
  });
  await q.enqueue(item("a"));
  await q.enqueue(item("b"));
  assert.equal((await q.list()).length, 2);
  assert.deepEqual(sent, []);
  online = true; // retour du réseau
  const n = await q.flush();
  assert.equal(n, 2);
  assert.deepEqual(sent, ["a", "b"]); // ordre de prise conservé
  assert.equal((await q.list()).length, 0);
});

test("erreur définitive : retirée de la file et signalée ; les suivantes partent", async () => {
  const dropped = [];
  const sent = [];
  const q = createPhotoQueue({
    store: memoryStore(),
    upload: async (it) => {
      if (it.id === "x") throw { code: "42501", message: "RLS" };
      sent.push(it.id);
    },
    onDrop: (it) => dropped.push(it.id),
  });
  await q.enqueue(item("x"));
  await q.enqueue(item("y"));
  assert.deepEqual(dropped, ["x"]);
  assert.deepEqual(sent, ["y"]);
  assert.equal((await q.list()).length, 0);
});

test("flush concurrents mutualisés (pas de double envoi)", async () => {
  let calls = 0;
  const store = memoryStore();
  await store.put(item("a", { queuedAt: "1" }));
  const q = createPhotoQueue({ store, upload: async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); } });
  await Promise.all([q.flush(), q.flush(), q.flush()]);
  assert.equal(calls, 1);
});

test("sortPhotos : Avant puis Après, chronologique", () => {
  const out = sortPhotos([
    { id: 1, type: "apres", taken_at: "2026-01-01T10:00" },
    { id: 2, type: "avant", taken_at: "2026-01-01T11:00" },
    { id: 3, type: "avant", taken_at: "2026-01-01T09:00" },
  ]);
  assert.deepEqual(out.map((p) => p.id), [3, 2, 1]);
});

test("élément ajouté pendant un envoi en cours : envoyé dans la foulée (beta.36)", async () => {
  const store = memoryStore();
  const sent = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const q = createPhotoQueue({
    store,
    upload: async (it) => { if (it.id === "a") await gate; sent.push(it.id); },
  });
  const p1 = q.enqueue({ id: "a", queuedAt: "1" });
  await new Promise((r) => setTimeout(r, 5));
  const p2 = q.enqueue({ id: "b", queuedAt: "2" });
  release();
  await Promise.all([p1, p2]);
  assert.deepEqual(sent, ["a", "b"]);
  assert.equal((await q.list()).length, 0);
});
