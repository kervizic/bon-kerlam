/* lv-visibility.test.mjs — vue chauffeur : chacun ne voit que SES lettres (beta.26).
 * Cas clé : un compte bureau basculé en vue chauffeur ne voit PAS la lettre d'un
 * autre ; en vue bureau, il la voit. */
import test from "node:test";
import assert from "node:assert/strict";
import { ownsLettre, filterLettresForView } from "./lv-visibility.js";

const ROWS = [
  { id: 1, numero: "KER-1", owner_email: "guillaume@kerlam.fr" },
  { id: 2, numero: "KER-2", owner_email: "Manu@Kervizic.fr" }, // casse mixte
  { id: 3, numero: "KER-3", owner_email: "jb@kerlam.fr" },
  { id: 4, numero: "KER-4", owner_email: null },               // sans propriétaire
];

test("ownsLettre : comparaison insensible à la casse et aux espaces", () => {
  assert.equal(ownsLettre({ owner_email: "Manu@Kervizic.fr" }, "manu@kervizic.fr"), true);
  assert.equal(ownsLettre({ owner_email: " guillaume@kerlam.fr " }, "GUILLAUME@kerlam.fr"), true);
  assert.equal(ownsLettre({ owner_email: "jb@kerlam.fr" }, "manu@kervizic.fr"), false);
  assert.equal(ownsLettre({ owner_email: null }, "manu@kervizic.fr"), false);
  assert.equal(ownsLettre({ owner_email: "jb@kerlam.fr" }, ""), false);
});

test("vue chauffeur : un compte bureau ne voit QUE ses lettres", () => {
  // Guillaume (bureau+chauffeur) basculé en vue chauffeur.
  const r = filterLettresForView(ROWS, { mode: "chauffeur", email: "guillaume@kerlam.fr" });
  assert.deepEqual(r.map((l) => l.id), [1]);
});

test("vue chauffeur : la lettre d'autrui est masquée", () => {
  const r = filterLettresForView(ROWS, { mode: "chauffeur", email: "manu@kervizic.fr" });
  assert.deepEqual(r.map((l) => l.id), [2]); // sa propre lettre (casse différente)
  assert.ok(!r.some((l) => l.id === 1), "ne doit pas voir la lettre de Guillaume");
});

test("vue bureau : toutes les lettres restent visibles", () => {
  const r = filterLettresForView(ROWS, { mode: "bureau", email: "manu@kervizic.fr" });
  assert.deepEqual(r.map((l) => l.id), [1, 2, 3, 4]);
});

test("vue chauffeur sans e-mail connu : fail-closed (rien)", () => {
  assert.deepEqual(filterLettresForView(ROWS, { mode: "chauffeur", email: "" }), []);
  assert.deepEqual(filterLettresForView(ROWS, { mode: "chauffeur" }), []);
});

test("entrée non-tableau : jamais d'exception", () => {
  assert.deepEqual(filterLettresForView(null, { mode: "chauffeur", email: "x@y.fr" }), []);
  assert.deepEqual(filterLettresForView(undefined, { mode: "bureau" }), []);
});
