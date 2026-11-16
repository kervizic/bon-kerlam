import assert from "node:assert/strict";
import { test } from "node:test";

import { swipeActionsFor } from "./swipe-actions.js";

test("lettre signable non signée : Signer + PDF + Corbeille, corbeille en dernier", () => {
  const a = swipeActionsFor({ statut: "en_cours", numero: "KER-1" }, { signable: true });
  assert.deepEqual(a.map((x) => x.key), ["signer", "pdf", "corbeille"]);
  assert.equal(a[a.length - 1].key, "corbeille");
  assert.equal(a[a.length - 1].danger, true);
});

test("brouillon signable : Signer + PDF + Corbeille", () => {
  const a = swipeActionsFor({ statut: "preparee", numero: null }, { signable: true });
  assert.deepEqual(a.map((x) => x.key), ["signer", "pdf", "corbeille"]);
});

test("lettre signée : pas de Signer, pas de Corbeille (PDF seul)", () => {
  const a = swipeActionsFor({ statut: "signee", numero: "KER-2" }, { signable: false });
  assert.deepEqual(a.map((x) => x.key), ["pdf"]);
});

test("lettre non signable (ex. envoyée) : pas de Signer, mais Corbeille possible", () => {
  const a = swipeActionsFor({ statut: "envoyee", numero: "KER-3" }, { signable: false });
  assert.deepEqual(a.map((x) => x.key), ["pdf", "corbeille"]);
});
