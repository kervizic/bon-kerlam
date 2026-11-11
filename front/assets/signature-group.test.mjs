import assert from "node:assert/strict";
import { test } from "node:test";

import { canGroupForSignature } from "./signature-group.js";

test("sélection vide : refus", () => {
  assert.equal(canGroupForSignature([]).ok, false);
  assert.equal(canGroupForSignature(null).ok, false);
});

test("même contact : groupage autorisé", () => {
  const r = canGroupForSignature([
    { id: 1, contact_id: 7 },
    { id: 2, contact_id: 7 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.contactId, 7);
});

test("contacts différents : refus avec message", () => {
  const r = canGroupForSignature([
    { id: 1, contact_id: 7 },
    { id: 2, contact_id: 8 },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /même contact/i);
});

test("lettre sans contact : refus", () => {
  const r = canGroupForSignature([
    { id: 1, contact_id: 7 },
    { id: 2, contact_id: null },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /contact signataire/i);
});

test("une seule lettre avec contact : autorisé", () => {
  assert.equal(canGroupForSignature([{ id: 1, contact_id: 3 }]).ok, true);
});
