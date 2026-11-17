import assert from "node:assert/strict";
import { test } from "node:test";

import { groupBySignataire, signatureBatches } from "./signature-group.js";

// Référentiel contacts : A (avec e-mail), B (avec e-mail), C (sans e-mail).
const CONTACTS = {
  10: { nom: "Contact A", email: "a@example.test" },
  20: { nom: "Contact B", email: "b@example.test" },
  30: { nom: "Contact C", email: "" },
};

// 5 lettres pour A, 1 pour B.
const LVS_A5_B1 = [
  { id: 1, numero: "KER-1", contact_id: 10 },
  { id: 2, numero: "KER-2", contact_id: 10 },
  { id: 3, numero: "KER-3", contact_id: 10 },
  { id: 4, numero: "KER-4", contact_id: 10 },
  { id: 5, numero: "KER-5", contact_id: 10 },
  { id: 6, numero: "KER-6", contact_id: 20 },
];

test("groupBySignataire : 2 groupes (A=5, B=1)", () => {
  const { groups, sansContact } = groupBySignataire(LVS_A5_B1, CONTACTS);
  assert.equal(sansContact.length, 0);
  assert.equal(groups.length, 2);
  const a = groups.find((g) => g.contactId === 10);
  const b = groups.find((g) => g.contactId === 20);
  assert.equal(a.count, 5);
  assert.deepEqual(a.lvIds, [1, 2, 3, 4, 5]);
  assert.equal(a.nom, "Contact A");
  assert.equal(a.hasEmail, true);
  assert.equal(b.count, 1);
  assert.deepEqual(b.lvIds, [6]);
});

test("groupBySignataire : lettre sans contact signalée", () => {
  const { groups, sansContact } = groupBySignataire(
    [{ id: 1, contact_id: 10 }, { id: 2, contact_id: null }],
    CONTACTS,
  );
  assert.equal(groups.length, 1);
  assert.equal(sansContact.length, 1);
  assert.equal(sansContact[0].id, 2);
});

test("groupBySignataire : contact sans e-mail -> hasEmail=false", () => {
  const { groups } = groupBySignataire([{ id: 9, contact_id: 30 }], CONTACTS);
  assert.equal(groups[0].hasEmail, false);
});

test("présentiel : un seul signataire à la fois", () => {
  const { groups } = groupBySignataire(LVS_A5_B1, CONTACTS);
  // Cocher A et B en présentiel -> refus.
  const deux = signatureBatches(groups, "sur_place", [10, 20]);
  assert.equal(deux.ok, false);
  assert.match(deux.reason, /un seul signataire/i);
  // Cocher seulement A -> un lot de 5 lettres.
  const unA = signatureBatches(groups, "sur_place", [10]);
  assert.equal(unA.ok, true);
  assert.equal(unA.batches.length, 1);
  assert.deepEqual(unA.batches[0].lvIds, [1, 2, 3, 4, 5]);
  // Cocher seulement B -> un lot de 1 lettre.
  const unB = signatureBatches(groups, "sur_place", [20]);
  assert.equal(unB.ok, true);
  assert.deepEqual(unB.batches[0].lvIds, [6]);
});

test("par mail : plusieurs signataires -> 2 lots", () => {
  const { groups } = groupBySignataire(LVS_A5_B1, CONTACTS);
  const r = signatureBatches(groups, "par_mail", [10, 20]);
  assert.equal(r.ok, true);
  assert.equal(r.batches.length, 2);
  const a = r.batches.find((x) => x.contactId === 10);
  assert.deepEqual(a.lvIds, [1, 2, 3, 4, 5]);
  assert.equal(a.email, "a@example.test");
});

test("signataire sans e-mail : refusé et signalé", () => {
  const { groups } = groupBySignataire([{ id: 9, contact_id: 30 }], CONTACTS);
  const r = signatureBatches(groups, "par_mail", [30]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /sans e-mail/i);
});

test("aucun signataire coché : refus", () => {
  const { groups } = groupBySignataire(LVS_A5_B1, CONTACTS);
  assert.equal(signatureBatches(groups, "par_mail", []).ok, false);
});
