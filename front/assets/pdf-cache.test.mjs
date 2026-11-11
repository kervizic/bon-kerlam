import assert from "node:assert/strict";
import { test } from "node:test";

import { PdfCache, formatGeneratedAt, pdfCacheKey, shouldCachePdf } from "./pdf-cache.js";

function memoryBackend() {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.get(k); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async keys() { return [...m.keys()]; },
  };
}

test("pdfCacheKey préfixe stable", () => {
  assert.equal(pdfCacheKey(42), "lv-pdf-42");
});

test("shouldCachePdf : lettre non signée du chauffeur connecté", () => {
  assert.equal(shouldCachePdf({ id: 1, statut: "en_cours", chauffeur_id: 7 }, 7), true);
  assert.equal(shouldCachePdf({ id: 1, statut: "a_signer", chauffeur_id: 7 }, 7), true);
});

test("shouldCachePdf : lettre signée exclue", () => {
  assert.equal(shouldCachePdf({ id: 1, statut: "signee", chauffeur_id: 7 }, 7), false);
});

test("shouldCachePdf : autre chauffeur exclu", () => {
  assert.equal(shouldCachePdf({ id: 1, statut: "en_cours", chauffeur_id: 9 }, 7), false);
});

test("shouldCachePdf : garde-fous (lv nulle, sans chauffeur)", () => {
  assert.equal(shouldCachePdf(null, 7), false);
  assert.equal(shouldCachePdf({ id: 1, statut: "en_cours", chauffeur_id: 7 }, null), false);
  assert.equal(shouldCachePdf({ statut: "en_cours", chauffeur_id: 7 }, 7), false);
});

test("formatGeneratedAt : « généré le JJ/MM à HH:MM »", () => {
  const ts = new Date(2026, 10, 11, 9, 5).getTime(); // 11/11 09:05 (mois 0-indexé)
  assert.equal(formatGeneratedAt(ts), "généré le 11/11 à 09:05");
});

test("PdfCache put/get", async () => {
  const cache = new PdfCache(memoryBackend());
  await cache.put(3, "BLOB", 123);
  const v = await cache.get(3);
  assert.equal(v.blob, "BLOB");
  assert.equal(v.generatedAt, 123);
  assert.equal(v.lvId, 3);
  assert.equal(await cache.get(99), null);
});

test("PdfCache purge n'efface que les entrées PDF", async () => {
  const backend = memoryBackend();
  backend._m.set("autre-cle", "garde-moi");
  const cache = new PdfCache(backend);
  await cache.put(1, "A", 1);
  await cache.put(2, "B", 2);
  await cache.purge();
  assert.equal(await cache.get(1), null);
  assert.equal(await cache.get(2), null);
  assert.equal(backend._m.get("autre-cle"), "garde-moi");
});
