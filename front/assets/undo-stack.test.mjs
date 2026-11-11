/* Tests de la pile d'annulation (node --test). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UndoStack } from "./undo-stack.js";

test("vide au départ : bouton masqué", () => {
  let visibleChanges = 0;
  const s = new UndoStack(() => { visibleChanges++; });
  assert.equal(s.isEmpty, true);
  assert.equal(s.size, 0);
});

test("apparaît après une modification, disparaît quand la pile est vide", async () => {
  const states = [];
  const s = new UndoStack(() => states.push(s.isEmpty));
  let value = "a";
  s.push(() => { value = "a"; });       // 1re modif
  assert.equal(s.isEmpty, false);       // bouton visible
  value = "b";
  await s.undo();                        // annule -> value revient à "a"
  assert.equal(value, "a");
  assert.equal(s.isEmpty, true);         // bouton masqué de nouveau
  // onChange appelé à chaque push/undo, avec le bon état
  assert.deepEqual(states, [false, true]);
});

test("LIFO : annule dans l'ordre inverse", async () => {
  const log = [];
  const s = new UndoStack();
  s.push(() => log.push("undo1"));
  s.push(() => log.push("undo2"));
  await s.undo();
  await s.undo();
  assert.deepEqual(log, ["undo2", "undo1"]);
  assert.equal(s.isEmpty, true);
});

test("reset vide la pile (sortie de formulaire)", async () => {
  const s = new UndoStack();
  s.push(() => {});
  s.push(() => {});
  assert.equal(s.size, 2);
  s.reset();
  assert.equal(s.isEmpty, true);
  // plus rien à annuler après reset
  const ran = await s.undo();
  assert.equal(ran, false);
});

test("pas de refaire : aucune API redo", () => {
  const s = new UndoStack();
  assert.equal("redo" in s, false);
  assert.equal(typeof s.redo, "undefined");
});

test("undo sur pile vide ne lève pas et retourne false", async () => {
  const s = new UndoStack();
  assert.equal(await s.undo(), false);
});

test("actions d'annulation asynchrones attendues", async () => {
  const s = new UndoStack();
  let done = false;
  s.push(async () => { await Promise.resolve(); done = true; });
  await s.undo();
  assert.equal(done, true);
});
