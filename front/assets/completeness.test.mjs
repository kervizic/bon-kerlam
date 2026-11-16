/* completeness.test.mjs — contrôle de complétude d'une lettre (beta.20). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lvCompleteness, entityMissingFields } from "./completeness.js";

const REFS = {
  clients: [
    { id: 1, raison_sociale: "YPREMA", adresse: "6 rue Freycinet, 77400 Lagny" },
    { id: 2, raison_sociale: "Sans adresse", adresse: "" },
  ],
  contacts: [
    { id: 10, nom: "Jean", email: "jean@kerlam.fr" },
    { id: 11, nom: "Sans mail", email: "" },
  ],
};

const FULL_LV = { client_id: 1, date_etablissement: "2026-11-15", contact_id: 10, dest_identique: true };
const FULL_TOURS = [{ site_chargement_id: 5, site_dechargement_id: 6, lignes: [{ article_id: 3 }] }];

test("lettre complète : aucun manque", () => {
  assert.deepEqual(lvCompleteness(FULL_LV, FULL_TOURS, REFS), []);
});

test("lettre vide : liste tous les manques principaux", () => {
  const codes = lvCompleteness({}, [], REFS).map((m) => m.code);
  assert.ok(codes.includes("client"));
  assert.ok(codes.includes("date"));
  assert.ok(codes.includes("contact"));
  assert.ok(codes.includes("tours"));
});

test("contact sans e-mail -> contact_email", () => {
  const codes = lvCompleteness({ ...FULL_LV, contact_id: 11 }, FULL_TOURS, REFS).map((m) => m.code);
  assert.ok(codes.includes("contact_email"));
});

test("destinataire distinct sans adresse -> destinataire_adresse", () => {
  const lv = { ...FULL_LV, dest_identique: false, destinataire_client_id: 2 };
  const codes = lvCompleteness(lv, FULL_TOURS, REFS).map((m) => m.code);
  assert.ok(codes.includes("destinataire_adresse"));
});

test("destinataire identique mais client sans adresse -> adresse du client", () => {
  const lv = { client_id: 2, date_etablissement: "2026-11-15", contact_id: 10, dest_identique: true };
  const codes = lvCompleteness(lv, FULL_TOURS, REFS).map((m) => m.code);
  assert.ok(codes.includes("destinataire_adresse"));
});

test("tour incomplet : déchargement + marchandise manquants, avec anchor et n°", () => {
  const tours = [{ site_chargement_id: 5, site_dechargement_id: null, lignes: [] }];
  const miss = lvCompleteness(FULL_LV, tours, REFS);
  const codes = miss.map((m) => m.code);
  assert.ok(codes.includes("tour_1_dechargement"));
  assert.ok(codes.includes("tour_1_marchandise"));
  const dech = miss.find((m) => m.code === "tour_1_dechargement");
  assert.match(dech.label, /Tour 1 : site de déchargement manquant/);
  assert.match(dech.anchor, /f-site-dechargement/);
});

test("chaque manque porte un anchor non vide", () => {
  for (const m of lvCompleteness({}, [{ lignes: [] }], REFS)) {
    assert.ok(m.anchor && m.anchor.length > 0, `anchor manquant pour ${m.code}`);
  }
});

test("entityMissingFields : client sans adresse, contact sans e-mail", () => {
  assert.deepEqual(entityMissingFields("clients", { raison_sociale: "X", adresse: "" }), ["Adresse"]);
  assert.deepEqual(entityMissingFields("contacts", { nom: "X", email: "" }), ["E-mail"]);
  assert.deepEqual(entityMissingFields("clients", { raison_sociale: "X", adresse: "Y" }), []);
});
