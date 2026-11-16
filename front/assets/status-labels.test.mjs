import assert from "node:assert/strict";
import { test } from "node:test";

import { STATUT_LV_LABELS, statutLabel, lvBadge } from "./status-labels.js";

// Toutes les valeurs de l'enum bon.statut_lv (+ en_attente_signature).
const ENUM = [
  "preparee", "en_cours", "cloturee", "a_signer",
  "envoyee", "en_attente_signature", "signee", "facturee", "annulee",
];

test("chaque statut a un libellé français sans underscore ni code brut", () => {
  for (const code of ENUM) {
    const label = statutLabel(code);
    assert.ok(label, `libellé manquant pour ${code}`);
    assert.notEqual(label, code, `libellé brut pour ${code}`);
    assert.ok(!/_/.test(label), `underscore dans le libellé de ${code}: ${label}`);
    assert.ok(/[A-ZÀ-Ö]/.test(label[0]), `libellé non capitalisé pour ${code}: ${label}`);
  }
});

test("statutLabel : garde-fous", () => {
  assert.equal(statutLabel(""), "");
  assert.equal(statutLabel(null), "");
  assert.equal(statutLabel(undefined), "");
});

test("exemples attendus", () => {
  assert.equal(statutLabel("a_signer"), "À signer");
  assert.equal(statutLabel("en_cours"), "En cours");
  assert.equal(statutLabel("preparee"), "Préparée");
  assert.equal(statutLabel("signee"), "Signée");
  assert.equal(statutLabel("en_attente_signature"), "En attente de signature");
});

test("la table couvre exactement l'enum (pas d'oubli)", () => {
  for (const code of ENUM) assert.ok(code in STATUT_LV_LABELS, `absent de la table: ${code}`);
});

test("lvBadge : une lettre SANS numéro est toujours « Brouillon » (bug Clôturée)", () => {
  // Quel que soit le statut en base (y compris 'cloturee' posé à tort), un
  // brouillon (numero null) affiche « Brouillon », jamais « Clôturée ».
  for (const statut of ["en_cours", "preparee", "cloturee", "a_signer"]) {
    const b = lvBadge({ numero: null, statut });
    assert.equal(b.label, "Brouillon", `statut ${statut}`);
    assert.equal(b.cls, "brouillon");
  }
  assert.equal(lvBadge({ numero: "", statut: "cloturee" }).label, "Brouillon");
  assert.equal(lvBadge(null).label, "Brouillon");
});

test("lvBadge : une lettre numérotée garde son statut", () => {
  assert.deepEqual(lvBadge({ numero: "KER-03000", statut: "en_cours" }), {
    label: "En cours", cls: "en_cours",
  });
  assert.deepEqual(lvBadge({ numero: "KER-03000", statut: "signee" }), {
    label: "Signée", cls: "signee",
  });
});
