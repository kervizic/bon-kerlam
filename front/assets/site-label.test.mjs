/* site-label.test.mjs — libellé court d'adresse : préfixe société + séparateur retirés. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripSocietePrefix } from "./site-label.js";

test("retire le préfixe société ET le séparateur restant", () => {
  assert.equal(stripSocietePrefix("Veolia – Noisy", "Veolia"), "Noisy");
  assert.equal(stripSocietePrefix("Veolia – Usine des Terres", "Veolia"), "Usine des Terres");
  assert.equal(stripSocietePrefix("Cemex Ivry béton", "Cemex"), "Ivry béton");
  assert.equal(stripSocietePrefix("RFM - Bondy", "RFM"), "Bondy");
  assert.equal(stripSocietePrefix("YPREMA: Émerainville", "YPREMA"), "Émerainville");
});

test("un nom sans préfixe reste inchangé", () => {
  assert.equal(stripSocietePrefix("Dépôt Démo Claye", "Veolia"), "Dépôt Démo Claye");
  assert.equal(stripSocietePrefix("Dépôt Démo Claye", null), "Dépôt Démo Claye");
  // ne coupe pas un mot qui commence par le nom de société sans séparateur
  assert.equal(stripSocietePrefix("Veoliax Site", "Veolia"), "Veoliax Site");
});
