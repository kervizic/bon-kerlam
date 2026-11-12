/* index-html.test.mjs — garde-fous structurels sur front/index.html.
 *
 * 1) Aucun attribut id dupliqué (un double #quick-create-sheet a cassé la fiche
 *    rapide en beta.17 : la feuille s'ouvrait vide — openQuickCreate visait le
 *    second bloc, le premier était affiché). Ce test échoue si un id réapparaît.
 * 2) Les ancres de la fiche rapide (quick-create-body, -title, -error, -form,
 *    -save) existent en UN seul exemplaire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, "..", "index.html"), "utf8");

function idCounts(html) {
  const counts = new Map();
  // id="..." et id='...' (hors expressions JS : index.html n'a pas de script inline).
  const re = /\sid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
}

test("aucun id dupliqué dans index.html", () => {
  const counts = idCounts(HTML);
  const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n}x)`);
  assert.deepEqual(dups, [], `ids dupliqués : ${dups.join(", ")}`);
});

test("ancres de la fiche rapide présentes et uniques", () => {
  const counts = idCounts(HTML);
  for (const id of ["quick-create-sheet", "quick-create-body", "quick-create-title",
    "quick-create-error", "quick-create-form", "btn-quick-create-save"]) {
    assert.equal(counts.get(id), 1, `#${id} doit exister exactement une fois`);
  }
  // L'ancien conteneur (quick-create-fields) ne doit plus exister.
  assert.equal(counts.get("quick-create-fields"), undefined, "ancien #quick-create-fields non supprimé");
});
