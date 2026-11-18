/* tour-address.test.mjs — logique du sélecteur d'adresse de chantier (beta.28). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normAddr, matchesTokens, recentChantiers, buildCompletion,
  swapPatch, addressPatch, sitePatch, endpointLabel, endpointLatLon, coordsForText,
} from "./tour-address.js";

test("coordsForText : garde le GPS si identique ou modif mineure, l'efface sinon", () => {
  const sources = [{ adresse: "18 rue du Chantier, 77400 Lagny-sur-Marne", lat: 48.87, lon: 2.70 }];
  // identique (casse/espaces) -> garde
  assert.deepEqual(coordsForText("18 Rue du Chantier, 77400 Lagny-sur-Marne", sources), { lat: 48.87, lon: 2.70 });
  // modif mineure (même numéro + code postal, rue corrigée) -> garde
  assert.deepEqual(coordsForText("18 rue des Chantiers 77400 Lagny", sources), { lat: 48.87, lon: 2.70 });
  // autre numéro -> efface
  assert.equal(coordsForText("42 rue du Chantier, 77400 Lagny", sources), null);
  // autre ville (code postal différent) -> efface
  assert.equal(coordsForText("18 rue du Chantier, 75011 Paris", sources), null);
  // texte vide -> null
  assert.equal(coordsForText("", sources), null);
  // source sans coords -> null
  assert.equal(coordsForText("x", [{ adresse: "x" }]), null);
});

test("normAddr : accents, casse, ponctuation", () => {
  assert.equal(normAddr("12 Rue de l'Église, 77400 Lagny"), "12 rue de l eglise 77400 lagny");
  assert.equal(normAddr(null), "");
});

test("matchesTokens : tolérant, ordre libre des mots", () => {
  const a = "12 rue des Peupliers, 77400 Lagny";
  assert.equal(matchesTokens(a, "lagny peupliers"), true); // ordre inversé
  assert.equal(matchesTokens(a, "12 peupliers"), true);
  assert.equal(matchesTokens(a, "LAGNY"), true);           // casse
  assert.equal(matchesTokens(a, "marseille"), false);
  assert.equal(matchesTokens(a, ""), true);                // vide = tout passe
});

const USAGES = [
  { adresse: "Chantier A, Lagny", lat: 1, lon: 1, client_id: 10, derniere: "2026-11-17T10:00:00Z" },
  { adresse: "chantier a, lagny", lat: 1, lon: 1, client_id: 10, derniere: "2026-11-10T10:00:00Z" }, // doublon (casse)
  { adresse: "Chantier B, Meaux", lat: 2, lon: 2, client_id: 10, derniere: "2026-09-01T10:00:00Z" }, // >30j (hors "récents")
  { adresse: "Chantier C, Paris", lat: 3, lon: 3, client_id: 20, derniere: "2026-11-16T10:00:00Z" }, // autre client
];
const NOW = Date.parse("2026-11-18T00:00:00Z");

test("recentChantiers : client, 30j, dédup, tri, max", () => {
  const r = recentChantiers(USAGES, 10, NOW, { days: 30, max: 5 });
  assert.deepEqual(r.map((u) => u.adresse), ["Chantier A, Lagny"]); // B >30j exclu, doublon fusionné, C autre client
  // max respecté
  const many = Array.from({ length: 8 }, (_, i) => ({ adresse: `Ch ${i}`, client_id: 10, derniere: `2026-11-1${i % 9}T10:00:00Z` }));
  assert.equal(recentChantiers(many, 10, NOW, { max: 5 }).length, 5);
});

test("buildCompletion : ordre client -> autres -> sites -> BAN, dédoublonné", () => {
  const sites = [{ id: 1, nom: "Cemex Ivry", adresse: "Quai Ivry" }];
  const ban = [{ label: "Chantier D, Lyon", lat: 4, lon: 4 }];
  const r = buildCompletion({
    query: "chantier", usages: USAGES, clientId: 10, sites,
    siteLabel: (s) => s.nom, banResults: ban,
  });
  // 'chantier' matche A+B (client, A dédoublonné), C (autre), pas le site (Cemex), + BAN D.
  // Pas de filtre 30j ici (complétion = toutes dates).
  assert.deepEqual(r.map((x) => x.kind), ["client", "client", "autre", "ban"]);
  assert.equal(r[0].adresse, "Chantier A, Lagny");
  assert.equal(r[2].client_id, 20);
  assert.equal(r[3].adresse, "Chantier D, Lyon");
});

test("buildCompletion : les sites matchent et ne doublonnent pas la BAN", () => {
  const sites = [{ id: 1, nom: "Cemex Ivry", adresse: "Quai Ivry" }];
  const ban = [{ label: "Quai Ivry", lat: 4, lon: 4 }]; // même libellé qu'un site
  const r = buildCompletion({ query: "ivry", usages: [], clientId: 10, sites, siteLabel: (s) => s.nom, banResults: ban });
  assert.equal(r.length, 1); // le site d'abord, la BAN dédoublonnée (même norm)
  assert.equal(r[0].kind, "site");
});

test("swapPatch : inverse chargement et livraison (site + adresse)", () => {
  const tour = { site_chargement_id: 5, chargement_adresse: null, chargement_lat: null, chargement_lon: null,
    site_dechargement_id: null, dechargement_adresse: "Chantier X", dechargement_lat: 9, dechargement_lon: 8 };
  const p = swapPatch(tour);
  assert.equal(p.site_chargement_id, null);
  assert.equal(p.chargement_adresse, "Chantier X");
  assert.equal(p.chargement_lat, 9);
  assert.equal(p.site_dechargement_id, 5);
  assert.equal(p.dechargement_adresse, null);
});

test("addressPatch / sitePatch : effacent l'autre représentation", () => {
  const a = addressPatch("chargement", { adresse: "Rue Y", lat: 1, lon: 2 });
  assert.equal(a.site_chargement_id, null);
  assert.equal(a.chargement_adresse, "Rue Y");
  const s = sitePatch("dechargement", "7");
  assert.equal(s.site_dechargement_id, 7);
  assert.equal(s.dechargement_adresse, null);
  assert.equal(s.dechargement_lat, null);
});

test("endpointLabel : adresse prioritaire, sinon site, sinon placeholder", () => {
  assert.equal(endpointLabel({ chargement_adresse: "Chantier Z" }, "chargement", () => "SITE", "—"), "Chantier Z");
  assert.equal(endpointLabel({ site_chargement_id: 3 }, "chargement", (id) => "Cemex " + id, "—"), "Cemex 3");
  assert.equal(endpointLabel({}, "chargement", () => null, "Choisir…"), "Choisir…");
});

test("endpointLatLon : adresse puis site", () => {
  assert.deepEqual(endpointLatLon({ dechargement_lat: 1, dechargement_lon: 2 }, "dechargement", null), { lat: 1, lon: 2 });
  assert.deepEqual(endpointLatLon({ site_dechargement_id: 4 }, "dechargement", (id) => ({ lat: 5, lon: 6 })), { lat: 5, lon: 6 });
  assert.equal(endpointLatLon({}, "chargement", () => null), null);
});
