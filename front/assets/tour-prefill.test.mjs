/* tour-prefill.test.mjs — logique pure de la reprise des lignes au choix du lieu
 * de chargement (beta.34) : non-écrasement des lignes saisies, reprise des lignes
 * vides/reprises, normalisation RPC, pluriel des unités (« 1 benne »/« 2 bennes »). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isLigneVide,
  peutReprendre,
  lignesReprises,
  uniteLabel,
} from "./tour-prefill.js";

test("isLigneVide : ni article ni quantité = vide", () => {
  assert.equal(isLigneVide(null), true);
  assert.equal(isLigneVide({}), true);
  assert.equal(isLigneVide({ unite: "t" }), true);
  assert.equal(isLigneVide({ quantite: "" }), true);
  assert.equal(isLigneVide({ article_id: 5 }), false);
  assert.equal(isLigneVide({ quantite: "2" }), false);
  assert.equal(isLigneVide({ quantite: 0 }), false);
});

test("peutReprendre : liste vide ou lignes vides -> oui", () => {
  assert.equal(peutReprendre([]), true);
  assert.equal(peutReprendre([{}, { unite: "t" }]), true);
});

test("peutReprendre : une ligne saisie à la main -> non (jamais écraser)", () => {
  assert.equal(peutReprendre([{ article_id: 3, quantite: "1" }]), false);
  assert.equal(peutReprendre([{}, { quantite: "2" }]), false);
});

test("peutReprendre : lignes reprises non modifiées -> oui, modifiées -> non", () => {
  assert.equal(
    peutReprendre([{ article_id: 3, quantite: "1", _reprise: true }]),
    true,
  );
  assert.equal(
    peutReprendre([
      { article_id: 3, quantite: "1", _reprise: true, _userTouched: true },
    ]),
    false,
  );
});

test("lignesReprises : écarte les lignes vides, défaut unité = t", () => {
  const rows = [
    { article_id: 7, article_nom: "Gravats", quantite: "1", unite: "benne" },
    { article_id: null, quantite: null, unite: null },
    { article_id: 2, quantite: "3", unite: null },
  ];
  assert.deepEqual(lignesReprises(rows), [
    { article_id: 7, quantite: "1", unite: "benne" },
    { article_id: 2, quantite: "3", unite: "t" },
  ]);
  assert.deepEqual(lignesReprises(null), []);
});

test("uniteLabel : pluriel benne et unités connues", () => {
  assert.equal(uniteLabel("benne", 1), "benne");
  assert.equal(uniteLabel("benne", 2), "bennes");
  assert.equal(uniteLabel("benne", "2,5"), "bennes");
  assert.equal(uniteLabel("m3", 3), "m³");
  assert.equal(uniteLabel("t", 10), "t");
  assert.equal(uniteLabel("unite", 2), "unités");
  assert.equal(uniteLabel("big_bag", 2), "big bags");
  assert.equal(uniteLabel("inconnue", 1), "inconnue");
});
