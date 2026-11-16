/* tooltips.test.mjs — garde-fous sur les infobulles (beta.20).
 *
 * 1) Chaque champ du formulaire (FORM_FIELD_KEYS) a un texte d'aide défini et
 *    non vide dans TOOLTIPS.
 * 2) Le texte de la Date est EXACTEMENT « Jour du transport. ».
 * 3) Les attributs data-tt posés dans index.html référencent tous une clé
 *    connue (pas de faute de frappe) et les champs principaux y sont présents.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOLTIPS, FORM_FIELD_KEYS } from "./tooltips.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, "..", "index.html"), "utf8");

test("chaque champ du formulaire a une infobulle définie et non vide", () => {
  const manquants = FORM_FIELD_KEYS.filter(
    (k) => typeof TOOLTIPS[k] !== "string" || TOOLTIPS[k].trim() === "",
  );
  assert.deepEqual(manquants, [], `clés sans texte d'aide : ${manquants.join(", ")}`);
});

test("le texte de la Date est exactement « Jour du transport. »", () => {
  assert.equal(TOOLTIPS.date, "Jour du transport.");
});

test("tous les data-tt d'index.html référencent une clé connue", () => {
  const keys = [...HTML.matchAll(/\bdata-tt\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const inconnus = keys.filter((k) => !(k in TOOLTIPS));
  assert.deepEqual(inconnus, [], `data-tt inconnus : ${inconnus.join(", ")}`);
});

test("les champs principaux portent un data-tt dans index.html", () => {
  const keys = new Set([...HTML.matchAll(/\bdata-tt\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  const requis = [
    "date", "camion", "client", "projet", "contact", "destinataire", "heures",
    "prestations", "tours", "site_chargement", "site_dechargement",
  ];
  const absents = requis.filter((k) => !keys.has(k));
  assert.deepEqual(absents, [], `champs sans data-tt dans index.html : ${absents.join(", ")}`);
});
