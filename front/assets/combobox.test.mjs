/* Tests unitaires du combobox (node --test). Fonctions pures uniquement :
 * normalisation accents/casse, filtrage libellé + alias, surbrillance, récents. */

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeText,
  filterItems,
  orderWithRecents,
  highlightMatch,
  recentsKey,
  getRecents,
  pushRecent,
} from "./combobox.js";

test("normalizeText supprime accents, casse et espaces", () => {
  assert.equal(normalizeText("  Évacuation  "), "evacuation");
  assert.equal(normalizeText("Société"), "societe");
  assert.equal(normalizeText("ÀÉÎÔÛ"), "aeiou");
  assert.equal(normalizeText(null), "");
});

const ITEMS = [
  { value: "1", label: "EJL (Jean Lefebvre)", alias: "Jean Lefebvre" },
  { value: "2", label: "Société Voirie de Travaux Publics (SVTP)", alias: "SVTP" },
  { value: "3", label: "Gleizon Travaux Publics", alias: "Gleizon" },
  { value: "4", label: "Veolia Propreté", alias: "Veolia" },
];

test("filterItems trouve via le libellé, insensible accents/casse", () => {
  const r = filterItems(ITEMS, "societe");
  assert.equal(r.length, 1);
  assert.equal(r[0].value, "2");
});

test("filterItems trouve via l'alias (ex. « jean » -> EJL)", () => {
  const r = filterItems(ITEMS, "jean");
  assert.equal(r.length, 1);
  assert.equal(r[0].value, "1");
});

test("filterItems « svtp » -> SVTP via alias", () => {
  const r = filterItems(ITEMS, "SVTP");
  assert.equal(r.length, 1);
  assert.equal(r[0].value, "2");
});

test("filterItems requête vide renvoie tout", () => {
  assert.equal(filterItems(ITEMS, "").length, ITEMS.length);
});

test("orderWithRecents place les récents en tête puis alpha", () => {
  const ordered = orderWithRecents(ITEMS, ["4", "2"]);
  assert.deepEqual(ordered.map((i) => i.value), ["4", "2", "1", "3"]);
  // Sans récent : alphabétique français.
  const alpha = orderWithRecents(ITEMS, []);
  assert.deepEqual(alpha.map((i) => i.value), ["1", "3", "2", "4"]);
});

test("highlightMatch surligne la portion trouvée, accents compris", () => {
  assert.equal(highlightMatch("Société", "societe"), "<mark>Société</mark>");
  assert.equal(highlightMatch("EJL (Jean Lefebvre)", "jean"), "EJL (<mark>Jean</mark> Lefebvre)");
  // Correspondance seulement via alias : pas de surbrillance du libellé.
  assert.equal(highlightMatch("Veolia Propreté", "xyz"), "Veolia Propreté");
  // Échappement HTML.
  assert.equal(highlightMatch("A & B", ""), "A &amp; B");
});

test("récents : clé, ajout MRU, plafond", () => {
  const store = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, v),
    };
  })();
  assert.equal(recentsKey("client", 7), "bon_recents_client_7");
  assert.deepEqual(getRecents("client", 7, store), []);
  pushRecent("client", 7, "2", 3, store);
  pushRecent("client", 7, "5", 3, store);
  pushRecent("client", 7, "2", 3, store); // remonte 2 en tête, sans doublon
  assert.deepEqual(getRecents("client", 7, store), ["2", "5"]);
  pushRecent("client", 7, "8", 3, store);
  pushRecent("client", 7, "9", 3, store);
  assert.deepEqual(getRecents("client", 7, store), ["9", "8", "2"]); // plafond 3
});
