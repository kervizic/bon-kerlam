/* tour-address.js — logique pure du sélecteur d'adresse de chantier sur un tour
 * (beta.28). Aucune dépendance DOM : testable (cf. tour-address.test.mjs).
 *
 * Une extrémité de tour (chargement/déchargement) est SOIT un site permanent
 * (site_*_id), SOIT une adresse de chantier libre (*_adresse + *_lat/_lon). Les
 * adresses de chantier ne sont jamais ajoutées à la liste des sites.
 */

// Normalisation tolérante : minuscule, sans accents, espaces/ponctuation condensés.
export function normAddr(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

// Tous les mots de la requête présents dans le texte (ordre libre : numéro/rue/ville).
export function matchesTokens(text, query) {
  const toks = normAddr(query).split(" ").filter(Boolean);
  if (!toks.length) return true;
  const hay = normAddr(text);
  return toks.every((t) => hay.includes(t));
}

function ms(d) {
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

// Section « Chantiers récents <client> » (sans frappe) : adresses de chantier du
// client sur `days` jours, dédoublonnées, triées par dernière utilisation, `max` max.
export function recentChantiers(usages, clientId, nowMs, { days = 30, max = 5 } = {}) {
  const floor = nowMs - days * 86400000;
  const seen = new Set();
  const out = [];
  const list = (usages || [])
    .filter((u) => u && u.adresse && sameId(u.client_id, clientId) && ms(u.derniere) >= floor)
    .sort((a, b) => ms(b.derniere) - ms(a.derniere));
  for (const u of list) {
    const k = normAddr(u.adresse);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

// Liste de complétion pendant la frappe, ordonnée et dédoublonnée :
// (0) projets du client AVEC adresse, (1) chantiers du même client, (2) chantiers
// des autres clients, (3) sites permanents, (4) résultats BAN. beta.30 : les projets
// du client avec adresse priment (juste après les projets de la lettre, rendus à part).
export function buildCompletion({ query, usages, clientId, sites, siteLabel, banResults, projets }) {
  const q = query || "";
  const seen = new Set();
  const out = [];
  const byRecent = (arr) => arr.slice().sort((a, b) => ms(b.derniere) - ms(a.derniere));
  const label = typeof siteLabel === "function" ? siteLabel : (s) => (s && s.nom) || "";

  const pushAddr = (u, kind) => {
    const k = normAddr(u.adresse);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ kind, type: "chantier", adresse: u.adresse, lat: u.lat, lon: u.lon, client_id: u.client_id });
  };

  // (0) Projets du client avec adresse.
  for (const p of projets || []) {
    if (!p || !p.adresse) continue;
    if (!matchesTokens(`${p.nom || ""} ${p.adresse}`, q)) continue;
    const k = normAddr(p.adresse);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: "projet", type: "projet", projet: p, adresse: p.adresse, lat: p.lat, lon: p.lon, label: p.nom || p.adresse });
  }

  const all = (usages || []).filter((u) => u && u.adresse);
  for (const u of byRecent(all.filter((u) => sameId(u.client_id, clientId)))) {
    if (matchesTokens(u.adresse, q)) pushAddr(u, "client");
  }
  for (const u of byRecent(all.filter((u) => !sameId(u.client_id, clientId)))) {
    if (matchesTokens(u.adresse, q)) pushAddr(u, "autre");
  }
  for (const s of sites || []) {
    const lbl = label(s);
    if (!matchesTokens(`${lbl} ${s.adresse || ""}`, q)) continue;
    const k = "site:" + s.id;
    if (seen.has(k)) continue;
    seen.add(k);
    if (s.adresse) seen.add(normAddr(s.adresse)); // la BAN ne doublonnera pas cette adresse
    out.push({ kind: "site", type: "site", site: s, label: lbl, adresse: s.adresse || "" });
  }
  for (const b of banResults || []) {
    const k = normAddr(b.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: "ban", type: "chantier", adresse: b.label, lat: b.lat, lon: b.lon });
  }
  return out;
}

// Inversion chargement <-> livraison : objet de patch pour l'autosave.
export function swapPatch(tour) {
  const t = tour || {};
  return {
    site_chargement_id: t.site_dechargement_id != null ? t.site_dechargement_id : null,
    chargement_adresse: t.dechargement_adresse != null ? t.dechargement_adresse : null,
    chargement_lat: t.dechargement_lat != null ? t.dechargement_lat : null,
    chargement_lon: t.dechargement_lon != null ? t.dechargement_lon : null,
    site_dechargement_id: t.site_chargement_id != null ? t.site_chargement_id : null,
    dechargement_adresse: t.chargement_adresse != null ? t.chargement_adresse : null,
    dechargement_lat: t.chargement_lat != null ? t.chargement_lat : null,
    dechargement_lon: t.chargement_lon != null ? t.chargement_lon : null,
  };
}

// Patch pour poser une adresse de chantier (efface le site permanent de ce côté).
export function addressPatch(which, { adresse, lat, lon }) {
  if (which === "chargement") {
    return { site_chargement_id: null, chargement_adresse: adresse, chargement_lat: lat != null ? lat : null, chargement_lon: lon != null ? lon : null };
  }
  return { site_dechargement_id: null, dechargement_adresse: adresse, dechargement_lat: lat != null ? lat : null, dechargement_lon: lon != null ? lon : null };
}

// Patch pour poser un site permanent (efface l'adresse de chantier de ce côté).
export function sitePatch(which, siteId) {
  const id = siteId != null ? Number(siteId) : null;
  if (which === "chargement") {
    return { site_chargement_id: id, chargement_adresse: null, chargement_lat: null, chargement_lon: null };
  }
  return { site_dechargement_id: id, dechargement_adresse: null, dechargement_lat: null, dechargement_lon: null };
}

// Libellé courant d'une extrémité (pour le bouton d'affichage) : adresse de
// chantier si présente, sinon libellé du site, sinon placeholder.
export function endpointLabel(tour, which, siteLabelById, placeholder) {
  const t = tour || {};
  const addr = which === "chargement" ? t.chargement_adresse : t.dechargement_adresse;
  if (addr) return addr;
  const sid = which === "chargement" ? t.site_chargement_id : t.site_dechargement_id;
  if (sid != null) {
    const lbl = siteLabelById ? siteLabelById(sid) : null;
    if (lbl) return lbl;
  }
  return placeholder || "Choisir…";
}

// beta.29.1 : première valeur numérique = numéro de voirie (1 à 4 chiffres).
function firstNumber(s) {
  const m = normAddr(s).match(/\b(\d{1,4})\b/);
  return m ? m[1] : null;
}
// Code postal français (5 chiffres).
function postcode(s) {
  const m = normAddr(s).match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

// Coordonnées GPS à conserver pour un texte d'adresse ÉDITÉ, à partir des sources
// connues (GPS « Ici », suggestions BAN, adresse déjà posée). On garde les
// coordonnées si le texte correspond exactement à une source (après normalisation)
// OU s'il s'agit d'une modification MINEURE (même numéro de voirie + même code
// postal). Si le texte vise une autre rue/ville -> null (lat/lon effacés).
export function coordsForText(text, sources) {
  const nt = normAddr(text);
  if (!nt) return null;
  const withCoords = (sources || []).filter((s) => s && s.lat != null && s.lon != null);
  for (const s of withCoords) {
    if (normAddr(s.adresse) === nt) return { lat: s.lat, lon: s.lon };
  }
  const n = firstNumber(text);
  const pc = postcode(text);
  if (n && pc) {
    for (const s of withCoords) {
      if (firstNumber(s.adresse) === n && postcode(s.adresse) === pc) return { lat: s.lat, lon: s.lon };
    }
  }
  return null;
}

// Coordonnées de navigation d'une extrémité (adresse de chantier ou site).
export function endpointLatLon(tour, which, siteById) {
  const t = tour || {};
  const addrLat = which === "chargement" ? t.chargement_lat : t.dechargement_lat;
  const addrLon = which === "chargement" ? t.chargement_lon : t.dechargement_lon;
  if (addrLat != null && addrLon != null) return { lat: addrLat, lon: addrLon };
  const sid = which === "chargement" ? t.site_chargement_id : t.site_dechargement_id;
  const s = sid != null && siteById ? siteById(sid) : null;
  if (s && s.lat != null && s.lon != null) return { lat: s.lat, lon: s.lon };
  return null;
}
