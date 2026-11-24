/* data.js — façade d'accès aux données : bascule transparente entre le vrai
 * client Supabase (assets/supabase-client.js) et le jeu de données fictif du
 * mode démo (assets/demo-data.js) piloté par `?demo=1` dans l'URL.
 *
 * Pourquoi une façade plutôt que des `if (demo)` disséminés dans app.js :
 * app.js importe les fonctions de data.js SOUS LES MÊMES NOMS que celles de
 * supabase-client.js (getLv, createTour, listCamions, ...) — aucun appelant
 * n'a besoin de savoir dans quel mode il tourne. Le mode démo doit être
 * TOTALEMENT inerte en usage normal (pas de ?demo=1) : `isDemoMode()` renvoie
 * alors false et chaque fonction ci-dessous délègue immédiatement au vrai
 * client, sans aucun détour.
 */

import * as live from "./supabase-client.js";
import * as seed from "./demo-data.js";

const params = new URLSearchParams(window.location.search);
const DEMO = params.get("demo") === "1";

export function isDemoMode() {
  return DEMO;
}
export function demoScreenParam() {
  return params.get("screen") || null;
}
export function demoThemeParam() {
  const t = params.get("theme");
  return t === "clair" || t === "sombre" ? t : null;
}

export const sb = DEMO ? null : live.sb;

/* ----------------------------------------------------- Magasin démo mutable == */
// Tables en mémoire, clonées depuis le seed au premier accès (une seule fois
// par session d'onglet) pour que les écritures de la démo (autosave, création)
// persistent pendant la navigation sans jamais toucher le réseau.
const demoDb = DEMO
  ? {
      camions: seed.cloneSeed(seed.CAMIONS),
      chauffeurs: seed.cloneSeed(seed.CHAUFFEURS),
      clients: seed.cloneSeed(seed.CLIENTS),
      contacts: seed.cloneSeed(seed.CONTACTS),
      projets: seed.cloneSeed(seed.PROJETS),
      sites: seed.cloneSeed(seed.SITES),
      articles: seed.cloneSeed(seed.ARTICLES),
      materiels: seed.cloneSeed(seed.MATERIELS),
      prestations: seed.cloneSeed(seed.PRESTATIONS),
      lv_prestations: seed.cloneSeed(seed.LV_PRESTATIONS),
      utilisateurs: seed.cloneSeed(seed.UTILISATEURS),
      reglages: seed.cloneSeed(seed.REGLAGES),
      lettres_voiture: seed.cloneSeed(seed.LETTRES_VOITURE),
      tours: seed.cloneSeed(seed.TOURS),
      tour_lignes: seed.cloneSeed(seed.TOUR_LIGNES),
      permis: seed.cloneSeed(seed.PERMIS),
      permis_categories: seed.cloneSeed(seed.PERMIS_CATEGORIES),
      fco: seed.cloneSeed(seed.FCO),
      carte_conducteur: seed.cloneSeed(seed.CARTE_CONDUCTEUR),
      caces: seed.cloneSeed(seed.CACES),
      client_adresses: seed.cloneSeed(seed.CLIENT_ADRESSES || []),
      site_societes: seed.cloneSeed(seed.SITE_SOCIETES || []),
      fusions: [],
      doublons_clients: seed.cloneSeed(seed.DOUBLONS_CLIENTS || []),
      doublons_sites: seed.cloneSeed(seed.DOUBLONS_SITES || []),
    }
  : null;

// CRUD démo minimal (ids horodatés) pour les tables beta.22 absentes du seed.
function demoCrudLocal(table) {
  return {
    create: async (fields) => {
      const row = { id: Date.now() + Math.floor(Math.random() * 1000), actif: true, ...fields };
      demoDb[table].push(row);
      return row;
    },
    update: async (id, patch) => {
      const row = byId(demoDb[table], id);
      if (row) Object.assign(row, patch);
      return row;
    },
    delete: async (id) => {
      demoDb[table] = demoDb[table].filter((r) => String(r.id) !== String(id));
    },
  };
}

// Fusion démo : marque les fiches fusionnées, journalise, réversible en mémoire.
function demoFusionner(kind, gardeId, fusionnesIds) {
  const table = kind === "clients" ? "clients" : kind === "sites" ? "sites" : "site_societes";
  const type = kind === "clients" ? "client" : kind === "sites" ? "site" : "site_societe";
  let done = 0;
  for (const fid of fusionnesIds || []) {
    if (String(fid) === String(gardeId)) continue;
    const row = byId(demoDb[table], fid);
    if (!row || row.merged_into_id) continue;
    const snapshot = { ...row };
    row.merged_into_id = gardeId;
    if (table === "sites") row.statut = "termine"; else row.actif = false;
    demoDb.fusions.push({ id: Date.now() + demoDb.fusions.length, type, garde_id: gardeId, fusionne_id: fid, snapshot });
    done += 1;
  }
  return { type, garde: gardeId, fusionnes: done };
}
function demoFusionAnnuler(fusionId) {
  const fu = byId(demoDb.fusions, fusionId);
  if (!fu || fu.annulee_at) return { deja_annulee: !!fu };
  const table = fu.type === "client" ? "clients" : fu.type === "site" ? "sites" : "site_societes";
  const row = byId(demoDb[table], fu.fusionne_id);
  if (row) { row.merged_into_id = null; if (table === "sites") row.statut = "actif"; else row.actif = true; }
  fu.annulee_at = new Date().toISOString();
  return { annulee: true, type: fu.type };
}

function byId(rows, id) {
  return rows.find((r) => String(r.id) === String(id)) || null;
}

function demoCrud(table, kind) {
  return {
    list: async () => demoDb[table].slice(),
    get: async (id) => byId(demoDb[table], id),
    create: async (fields) => {
      const row = { id: seed.nextId(kind), ...fields };
      demoDb[table].push(row);
      return row;
    },
    update: async (id, patch) => {
      const row = byId(demoDb[table], id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return row;
    },
    delete: async (id) => {
      demoDb[table] = demoDb[table].filter((r) => String(r.id) !== String(id));
    },
  };
}

/* ------------------------------------------------------------------ Auth ===== */
export async function getSession() {
  if (DEMO) return { user: { id: "demo-user", email: seed.DEMO_PROFILE.email } };
  return live.getSession();
}
export function onAuthStateChange(callback) {
  if (DEMO) return { data: { subscription: { unsubscribe() {} } } };
  return live.onAuthStateChange(callback);
}
export async function signInWithGoogle() {
  if (DEMO) return;
  return live.signInWithGoogle();
}
export async function sendEmailOtp(email) {
  if (DEMO) return;
  return live.sendEmailOtp(email);
}
export async function verifyEmailOtp(email, code) {
  if (DEMO) return { session: null, user: null };
  return live.verifyEmailOtp(email, code);
}
export async function signOut() {
  if (DEMO) return;
  return live.signOut();
}
// Passkeys / Face ID (beta.27). En démo, on NE propose PAS de passkey (aucun
// backend auth) : webauthnSupported renvoie false pour désactiver toute l'UI.
export function webauthnSupported() {
  if (DEMO) return false;
  return live.webauthnSupported();
}
export async function platformAuthenticatorAvailable() {
  if (DEMO) return false;
  return live.platformAuthenticatorAvailable();
}
export async function registerPasskey() {
  if (DEMO) return { demo: true };
  return live.registerPasskey();
}
export async function signInWithPasskey() {
  if (DEMO) return { session: null, user: null };
  return live.signInWithPasskey();
}
export async function listPasskeys() {
  if (DEMO) return [];
  return live.listPasskeys();
}
export async function deletePasskey(passkeyId) {
  if (DEMO) return;
  return live.deletePasskey(passkeyId);
}
export async function getProfil() {
  if (DEMO) return seed.cloneSeed(seed.DEMO_PROFILE);
  return live.getProfil();
}
export async function getChauffeurByEmail(email) {
  if (DEMO) {
    const row = demoDb.chauffeurs.find((c) => (c.email || "").toLowerCase() === (email || "").toLowerCase());
    return row || seed.cloneSeed(seed.DEMO_CHAUFFEUR);
  }
  return live.getChauffeurByEmail(email);
}

/* ------------------------------------------------------- Lettres de voiture == */
export async function getLvDuJour(chauffeurId, date = todayIso()) {
  if (DEMO) {
    return (
      demoDb.lettres_voiture.find(
        (lv) => String(lv.chauffeur_id) === String(chauffeurId) && lv.date_etablissement === date && !lv.deleted_at
      ) || null
    );
  }
  return live.getLvDuJour(chauffeurId, date);
}
export async function getLv(lvId) {
  if (DEMO) return byId(demoDb.lettres_voiture, lvId);
  return live.getLv(lvId);
}
export async function createLv(fields) {
  if (DEMO) {
    const row = { id: seed.nextId("lv"), numero: null, statut: "en_cours", preparee: false, deleted_at: null, ...fields };
    demoDb.lettres_voiture.push(row);
    return row;
  }
  return live.createLv(fields);
}
export async function updateLv(lvId, patch) {
  if (DEMO) {
    const row = byId(demoDb.lettres_voiture, lvId);
    if (row) Object.assign(row, patch);
    return row;
  }
  return live.updateLv(lvId, patch);
}
export async function listLettresVoiture(opts) {
  if (DEMO) {
    // Les lettres annulées (numéro conservé) sont masquées des listes (0017).
    let rows = demoDb.lettres_voiture.filter((lv) => !lv.deleted_at && lv.statut !== "annulee");
    if (opts && opts.date) rows = rows.filter((lv) => lv.date_etablissement === opts.date);
    if (opts && opts.statut) rows = rows.filter((lv) => lv.statut === opts.statut);
    if (opts && opts.query) {
      const needle = opts.query.toLowerCase();
      rows = rows.filter(
        (lv) =>
          (lv.numero || "").toLowerCase().includes(needle) ||
          (lv.expediteur || "").toLowerCase().includes(needle) ||
          (lv.destinataire || "").toLowerCase().includes(needle)
      );
    }
    return rows.slice().sort((a, b) => (a.date_etablissement < b.date_etablissement ? 1 : -1));
  }
  return live.listLettresVoiture(opts);
}
export async function listPlanningLv() {
  if (DEMO) return demoDb.lettres_voiture.filter((lv) => lv.preparee && !lv.deleted_at && lv.statut !== "annulee");
  return live.listPlanningLv();
}

// Corbeille : lettres mises au rebut dans les 30 derniers jours (restaurables).
export async function listCorbeille() {
  if (DEMO) {
    const floor = Date.now() - 30 * 86400000;
    return demoDb.lettres_voiture
      .filter((lv) => lv.deleted_at && new Date(lv.deleted_at).getTime() > floor)
      .sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  }
  return live.listCorbeille();
}

// Suppression / annulation (0017) : brouillon -> corbeille ; numérotée -> annulée.
export async function rpcLvSupprimer(lvId, categorie, motif) {
  if (DEMO) {
    const lv = byId(demoDb.lettres_voiture, lvId);
    if (!lv) throw new Error("Lettre introuvable");
    if (lv.statut === "signee") throw new Error("Lettre signée : suppression impossible");
    if (!lv.numero) {
      lv.deleted_at = new Date().toISOString();
      return { mode: "corbeille", lv_id: lvId };
    }
    lv.statut = "annulee";
    lv.annulation_categorie = categorie || null;
    lv.annulation_motif = motif || null;
    lv.annulee_at = new Date().toISOString();
    return { mode: "annulee", lv_id: lvId, numero: lv.numero };
  }
  return live.rpcLvSupprimer(lvId, categorie, motif);
}

export async function rpcLvRestaurer(lvId) {
  if (DEMO) {
    const lv = byId(demoDb.lettres_voiture, lvId);
    if (lv) lv.deleted_at = null;
    return { restored: !!lv, lv_id: lvId };
  }
  return live.rpcLvRestaurer(lvId);
}

// Suppression GROUPÉE d'une sélection (beta.21) : brouillon -> corbeille,
// numérotée non signée -> annulée, signée -> ignorée. Renvoie le récap
// { corbeille, annulee, ignore_signee, ignore_autre }.
export async function rpcLvSupprimerLot(lvIds, categorie, motif) {
  if (DEMO) {
    let corbeille = 0, annulee = 0, ignore_signee = 0, ignore_autre = 0;
    for (const id of lvIds || []) {
      const lv = byId(demoDb.lettres_voiture, id);
      if (!lv) { ignore_autre += 1; continue; }
      if (lv.statut === "signee") { ignore_signee += 1; continue; }
      if (lv.deleted_at || lv.statut === "annulee") { ignore_autre += 1; continue; }
      if (!lv.numero) {
        lv.deleted_at = new Date().toISOString();
        corbeille += 1;
      } else {
        lv.statut = "annulee";
        lv.annulation_categorie = categorie || null;
        lv.annulation_motif = motif || null;
        lv.annulee_at = new Date().toISOString();
        annulee += 1;
      }
    }
    return { corbeille, annulee, ignore_signee, ignore_autre };
  }
  return live.rpcLvSupprimerLot(lvIds, categorie, motif);
}

// Mémoire des créneaux : créneaux de la dernière lettre du chauffeur qui en a.
export async function rpcDernieresHeures(chauffeurId) {
  if (DEMO) {
    const lettres = demoDb.lettres_voiture
      .filter((lv) => String(lv.chauffeur_id) === String(chauffeurId) && !lv.deleted_at && Array.isArray(lv.heures) && lv.heures.length)
      .sort((a, b) => (a.date_etablissement < b.date_etablissement ? 1 : a.date_etablissement > b.date_etablissement ? -1 : b.id - a.id));
    return lettres.length ? lettres[0].heures : null;
  }
  return live.rpcDernieresHeures(chauffeurId);
}

/* --------------------------------------------------------------------- Tours == */
export async function getTours(lvId) {
  if (DEMO) return demoDb.tours.filter((t) => String(t.lv_id) === String(lvId) && !t.deleted_at).sort((a, b) => a.ordre - b.ordre);
  return live.getTours(lvId);
}
export async function createTour(fields) {
  if (DEMO) {
    const siblings = demoDb.tours.filter((t) => String(t.lv_id) === String(fields.lv_id) && !t.deleted_at);
    const prev = siblings.sort((a, b) => b.ordre - a.ordre)[0];
    const row = {
      id: seed.nextId("tour"),
      ordre: siblings.length + 1,
      heure_depart: null,
      gps_lat: null,
      gps_lon: null,
      site_chargement_id: prev ? prev.site_dechargement_id : null,
      site_dechargement_id: null,
      expediteur: null,
      destinataire: null,
      deleted_at: null,
      ...fields,
    };
    demoDb.tours.push(row);
    // Premier tour de la LV : attribution du numéro, comme le trigger serveur.
    const lv = byId(demoDb.lettres_voiture, fields.lv_id);
    if (lv && !lv.numero) lv.numero = "KER-0" + (3000 + seed.nextId("lv"));
    return row;
  }
  return live.createTour(fields);
}
export async function updateTour(tourId, patch) {
  if (DEMO) {
    const row = byId(demoDb.tours, tourId);
    if (row) Object.assign(row, patch);
    return row;
  }
  return live.updateTour(tourId, patch);
}
export async function deleteTour(tourId) {
  if (DEMO) {
    const row = byId(demoDb.tours, tourId);
    if (row) row.deleted_at = new Date().toISOString();
    return;
  }
  return live.deleteTour(tourId);
}

/* ------------------------------------------------------------- Lignes d'article */
export async function getLignes(tourId) {
  if (DEMO) return demoDb.tour_lignes.filter((l) => String(l.tour_id) === String(tourId));
  return live.getLignes(tourId);
}
export async function createLigne(fields) {
  if (DEMO) {
    const row = { id: seed.nextId("ligne"), article_id: null, quantite: null, unite: "t", ...fields };
    demoDb.tour_lignes.push(row);
    return row;
  }
  return live.createLigne(fields);
}
export async function updateLigne(ligneId, patch) {
  if (DEMO) {
    const row = byId(demoDb.tour_lignes, ligneId);
    if (row) Object.assign(row, patch);
    return row;
  }
  return live.updateLigne(ligneId, patch);
}
export async function deleteLigne(ligneId) {
  if (DEMO) {
    demoDb.tour_lignes = demoDb.tour_lignes.filter((l) => String(l.id) !== String(ligneId));
    return;
  }
  return live.deleteLigne(ligneId);
}

/* ------------------------------------------------------------------ Référentiels */
export async function listSites() {
  if (DEMO) return demoDb.sites.filter((s) => s.statut === "actif");
  return live.listSites();
}
export async function listArticles() {
  if (DEMO) return demoDb.articles.filter((a) => a.actif);
  return live.listArticles();
}
export async function listArticlesAll() {
  if (DEMO) return demoDb.articles.slice();
  return live.listArticlesAll();
}
export async function listPrestations() {
  if (DEMO) return demoDb.prestations.filter((p) => p.actif);
  return live.listPrestations();
}
export async function listPrestationsAll() {
  if (DEMO) return demoDb.prestations.slice();
  return live.listPrestationsAll();
}
export async function listMateriels() {
  if (DEMO) return demoDb.materiels.filter((m) => m.actif);
  return live.listMateriels();
}
export async function listCamions() {
  if (DEMO) return demoDb.camions.filter((c) => c.actif);
  return live.listCamions();
}
export async function listClients() {
  if (DEMO) {
    return demoDb.clients.filter((c) => c.actif).map((c) => ({
      ...c,
      nb_adresses: (demoDb.client_adresses || [])
        .filter((a) => String(a.client_id) === String(c.id) && a.actif !== false).length,
      aliases: c.alias ? [c.alias] : [],
    }));
  }
  return live.listClients();
}
export async function listProjets(clientId) {
  if (DEMO) return demoDb.projets.filter((p) => !clientId || String(p.client_id) === String(clientId));
  return live.listProjets(clientId);
}
// beta.30 : liaison N-N lettre <-> projets.
export async function listLvProjets(lvId) {
  if (DEMO) { demoDb.lv_projets = demoDb.lv_projets || []; return demoDb.lv_projets.filter((r) => String(r.lv_id) === String(lvId)).map((r) => r.projet_id); }
  return live.listLvProjets(lvId);
}
export async function linkLvProjet(lvId, projetId) {
  if (DEMO) { demoDb.lv_projets = demoDb.lv_projets || []; if (!demoDb.lv_projets.some((r) => String(r.lv_id) === String(lvId) && String(r.projet_id) === String(projetId))) demoDb.lv_projets.push({ lv_id: lvId, projet_id: projetId }); return; }
  return live.linkLvProjet(lvId, projetId);
}
export async function unlinkLvProjet(lvId, projetId) {
  if (DEMO) { demoDb.lv_projets = (demoDb.lv_projets || []).filter((r) => !(String(r.lv_id) === String(lvId) && String(r.projet_id) === String(projetId))); return; }
  return live.unlinkLvProjet(lvId, projetId);
}
export async function listContacts(clientId) {
  if (DEMO) return demoDb.contacts.filter((c) => !clientId || String(c.client_id) === String(clientId));
  return live.listContacts(clientId);
}
export async function listChauffeurs() {
  if (DEMO) return demoDb.chauffeurs.slice();
  return live.listChauffeurs();
}
export async function listUtilisateurs() {
  if (DEMO) return demoDb.utilisateurs.slice();
  return live.listUtilisateurs();
}
export async function listReglages() {
  if (DEMO) return demoDb.reglages.slice();
  return live.listReglages();
}
export async function upsertReglage(cle, valeur) {
  if (DEMO) {
    const row = demoDb.reglages.find((r) => r.cle === cle);
    if (row) row.valeur = valeur;
    return row;
  }
  return live.upsertReglage(cle, valeur);
}

/* --------------------------------------------------------- CRUD référentiels == */
const dCamions = demoCrudSafe("camions", "camion");
const dChauffeurs = demoCrudSafe("chauffeurs", "chauffeur");
const dClients = demoCrudSafe("clients", "client");
const dContacts = demoCrudSafe("contacts", "contact");
const dProjets = demoCrudSafe("projets", "projet");
const dSites = demoCrudSafe("sites", "site");
const dArticles = demoCrudSafe("articles", "article");
const dPrestations = demoCrudSafe("prestations", "prestation");
const dUtilisateurs = demoCrudSafe("utilisateurs", "utilisateur");
const dClientAdresses = DEMO ? demoCrudLocal("client_adresses") : null;
const dSiteSocietes = DEMO ? demoCrudLocal("site_societes") : null;

function demoCrudSafe(table, kind) {
  return DEMO ? demoCrud(table, kind) : null;
}

export async function createCamion(fields) { return DEMO ? dCamions.create(fields) : live.createCamion(fields); }
export async function updateCamion(id, patch) { return DEMO ? dCamions.update(id, patch) : live.updateCamion(id, patch); }

export async function createChauffeur(fields) { return DEMO ? dChauffeurs.create(fields) : live.createChauffeur(fields); }
export async function updateChauffeur(id, patch) { return DEMO ? dChauffeurs.update(id, patch) : live.updateChauffeur(id, patch); }

export async function createClient(fields) { return DEMO ? dClients.create(fields) : live.createClient(fields); }
export async function updateClient(id, patch) { return DEMO ? dClients.update(id, patch) : live.updateClient(id, patch); }

export async function createContact(fields) { return DEMO ? dContacts.create(fields) : live.createContact(fields); }
export async function updateContact(id, patch) { return DEMO ? dContacts.update(id, patch) : live.updateContact(id, patch); }
export async function deleteContact(id) { return DEMO ? dContacts.delete(id) : live.deleteContact(id); }

export async function createProjet(fields) { return DEMO ? dProjets.create(fields) : live.createProjet(fields); }
export async function updateProjet(id, patch) { return DEMO ? dProjets.update(id, patch) : live.updateProjet(id, patch); }

export async function createSite(fields) { return DEMO ? dSites.create(fields) : live.createSite(fields); }
export async function updateSite(id, patch) { return DEMO ? dSites.update(id, patch) : live.updateSite(id, patch); }

// -------------------------------------------------- beta.22 : société -> adresses
export async function listClientAdresses(clientId) {
  if (DEMO) {
    const rows = (demoDb.client_adresses || []).filter(
      (a) => a.actif !== false && (!clientId || String(a.client_id) === String(clientId)));
    return rows.sort((a, b) => (b.is_principale ? 1 : 0) - (a.is_principale ? 1 : 0));
  }
  return live.listClientAdresses(clientId);
}
export async function createClientAdresse(fields) { return DEMO ? dClientAdresses.create(fields) : live.createClientAdresse(fields); }
export async function updateClientAdresse(id, patch) { return DEMO ? dClientAdresses.update(id, patch) : live.updateClientAdresse(id, patch); }
export async function deleteClientAdresse(id) { return DEMO ? dClientAdresses.delete(id) : live.deleteClientAdresse(id); }

export async function listSiteSocietes() {
  if (DEMO) return (demoDb.site_societes || []).filter((s) => s.actif !== false);
  return live.listSiteSocietes();
}
export async function createSiteSociete(fields) { return DEMO ? dSiteSocietes.create(fields) : live.createSiteSociete(fields); }
export async function updateSiteSociete(id, patch) { return DEMO ? dSiteSocietes.update(id, patch) : live.updateSiteSociete(id, patch); }

export async function rpcFusionnerClients(gardeId, fusionnesIds) {
  if (DEMO) return demoFusionner("clients", gardeId, fusionnesIds);
  return live.rpcFusionnerClients(gardeId, fusionnesIds);
}
export async function rpcFusionnerSites(gardeId, fusionnesIds) {
  if (DEMO) return demoFusionner("sites", gardeId, fusionnesIds);
  return live.rpcFusionnerSites(gardeId, fusionnesIds);
}
export async function rpcFusionnerSiteSocietes(gardeId, fusionnesIds) {
  if (DEMO) return demoFusionner("site_societes", gardeId, fusionnesIds);
  return live.rpcFusionnerSiteSocietes(gardeId, fusionnesIds);
}
export async function rpcFusionAnnuler(fusionId) {
  if (DEMO) return demoFusionAnnuler(fusionId);
  return live.rpcFusionAnnuler(fusionId);
}
export async function listDoublonsClients() {
  if (DEMO) return demoDb.doublons_clients || [];
  return live.listDoublonsClients();
}
export async function listDoublonsSites() {
  if (DEMO) return demoDb.doublons_sites || [];
  return live.listDoublonsSites();
}
export async function listFusions(opts) {
  if (DEMO) {
    return (demoDb.fusions || []).filter((f) => !f.annulee_at
      && (!opts || !opts.type || f.type === opts.type)
      && (!opts || !opts.gardeId || String(f.garde_id) === String(opts.gardeId)))
      .sort((a, b) => b.id - a.id);
  }
  return live.listFusions(opts);
}

export async function createArticle(fields) { return DEMO ? dArticles.create(fields) : live.createArticle(fields); }
export async function updateArticle(id, patch) { return DEMO ? dArticles.update(id, patch) : live.updateArticle(id, patch); }

export async function createPrestation(fields) { return DEMO ? dPrestations.create(fields) : live.createPrestation(fields); }
export async function updatePrestation(id, patch) { return DEMO ? dPrestations.update(id, patch) : live.updatePrestation(id, patch); }

/* ------------------------------------------------ Prestations d'une lettre (H) */
export async function getPrestationsLv(lvId) {
  if (DEMO) {
    return demoDb.lv_prestations
      .filter((p) => String(p.lv_id) === String(lvId))
      .sort((a, b) => (a.ordre - b.ordre) || (a.id - b.id));
  }
  return live.getPrestationsLv(lvId);
}
export async function createPrestationLigne(fields) {
  if (DEMO) {
    const row = { id: seed.nextId("lvPrestation"), prestation_id: null, quantite: null, unite: null, materiel_id: null, ordre: 1, ...fields };
    demoDb.lv_prestations.push(row);
    return row;
  }
  return live.createPrestationLigne(fields);
}
export async function updatePrestationLigne(id, patch) {
  if (DEMO) {
    const row = byId(demoDb.lv_prestations, id);
    if (row) Object.assign(row, patch);
    return row;
  }
  return live.updatePrestationLigne(id, patch);
}
export async function deletePrestationLigne(id) {
  if (DEMO) {
    demoDb.lv_prestations = demoDb.lv_prestations.filter((p) => String(p.id) !== String(id));
    return;
  }
  return live.deletePrestationLigne(id);
}
export async function rpcDernierePrestation(chauffeurId) {
  if (DEMO) {
    const lettres = demoDb.lettres_voiture
      .filter((lv) => String(lv.chauffeur_id) === String(chauffeurId) && !lv.deleted_at)
      .sort((a, b) => (a.date_etablissement < b.date_etablissement ? 1 : a.date_etablissement > b.date_etablissement ? -1 : b.id - a.id));
    for (const lv of lettres) {
      const lignes = demoDb.lv_prestations
        .filter((p) => String(p.lv_id) === String(lv.id))
        .sort((a, b) => (a.ordre - b.ordre) || (a.id - b.id));
      if (lignes.length) {
        const l = lignes[0];
        return { prestation_id: l.prestation_id, unite: l.unite, quantite: l.quantite, materiel_id: l.materiel_id };
      }
    }
    return null;
  }
  return live.rpcDernierePrestation(chauffeurId);
}
export async function rpcDerniereQuantiteEstimee(chauffeurId, clientId) {
  if (DEMO) {
    const lv = demoDb.lettres_voiture
      .filter((l) => String(l.chauffeur_id) === String(chauffeurId)
        && String(l.client_id) === String(clientId)
        && !l.deleted_at && l.quantite_estimee != null)
      .sort((a, b) => (a.date_etablissement < b.date_etablissement ? 1 : a.date_etablissement > b.date_etablissement ? -1 : b.id - a.id))[0];
    return lv ? { quantite: lv.quantite_estimee, unite: lv.quantite_estimee_unite } : null;
  }
  return live.rpcDerniereQuantiteEstimee(chauffeurId, clientId);
}

export async function createUtilisateur(fields) { return DEMO ? dUtilisateurs.create(fields) : live.createUtilisateur(fields); }
export async function updateUtilisateur(id, patch) { return DEMO ? dUtilisateurs.update(id, patch) : live.updateUtilisateur(id, patch); }

export async function rpcFusionnerArticle() {
  if (DEMO) throw new Error("RPC_ABSENTE");
  return live.rpcFusionnerArticle();
}

/* --------------------------------------------------------------- Documents === */
function demoDocGet(table, chauffeurId) {
  return demoDb[table].find((r) => String(r.chauffeur_id) === String(chauffeurId)) || null;
}
function demoDocUpsert(table, chauffeurId, patch) {
  let row = demoDocGet(table, chauffeurId);
  if (!row) {
    row = { id: Date.now(), chauffeur_id: chauffeurId };
    demoDb[table].push(row);
  }
  Object.assign(row, patch);
  return row;
}

export async function getPermis(chauffeurId) { return DEMO ? demoDocGet("permis", chauffeurId) : live.getPermis(chauffeurId); }
export async function upsertPermis(chauffeurId, patch) { return DEMO ? demoDocUpsert("permis", chauffeurId, patch) : live.upsertPermis(chauffeurId, patch); }

export async function listPermisCategories(chauffeurId) {
  if (DEMO) return demoDb.permis_categories.filter((p) => String(p.chauffeur_id) === String(chauffeurId));
  return live.listPermisCategories(chauffeurId);
}
export async function createPermisCategorie(chauffeurId, categorie, validite) {
  if (DEMO) {
    const row = { id: seed.nextId("permisCategorie"), chauffeur_id: chauffeurId, categorie, validite };
    demoDb.permis_categories.push(row);
    return row;
  }
  return live.createPermisCategorie(chauffeurId, categorie, validite);
}
export async function updatePermisCategorie(id, patch) {
  if (DEMO) {
    const row = byId(demoDb.permis_categories, id);
    if (row) Object.assign(row, patch);
    return row;
  }
  return live.updatePermisCategorie(id, patch);
}
export async function deletePermisCategorie(id) {
  if (DEMO) {
    demoDb.permis_categories = demoDb.permis_categories.filter((p) => String(p.id) !== String(id));
    return;
  }
  return live.deletePermisCategorie(id);
}

export async function getFco(chauffeurId) { return DEMO ? demoDocGet("fco", chauffeurId) : live.getFco(chauffeurId); }
export async function upsertFco(chauffeurId, patch) { return DEMO ? demoDocUpsert("fco", chauffeurId, patch) : live.upsertFco(chauffeurId, patch); }

export async function getCarteConducteur(chauffeurId) { return DEMO ? demoDocGet("carte_conducteur", chauffeurId) : live.getCarteConducteur(chauffeurId); }
export async function upsertCarteConducteur(chauffeurId, patch) { return DEMO ? demoDocUpsert("carte_conducteur", chauffeurId, patch) : live.upsertCarteConducteur(chauffeurId, patch); }

export async function listCaces(chauffeurId) {
  if (DEMO) return demoDb.caces.filter((c) => String(c.chauffeur_id) === String(chauffeurId));
  return live.listCaces(chauffeurId);
}
export async function createCaces(chauffeurId, fields) {
  if (DEMO) {
    const row = { id: seed.nextId("caces"), chauffeur_id: chauffeurId, categories: [], ...fields };
    demoDb.caces.push(row);
    return row;
  }
  return live.createCaces(chauffeurId, fields);
}
export async function updateCaces(id, patch) {
  if (DEMO) {
    const row = byId(demoDb.caces, id);
    if (row) Object.assign(row, patch);
    return row;
  }
  return live.updateCaces(id, patch);
}
export async function deleteCaces(id) {
  if (DEMO) {
    demoDb.caces = demoDb.caces.filter((c) => String(c.id) !== String(id));
    return;
  }
  return live.deleteCaces(id);
}

export async function rpcAlertesDocuments() {
  if (DEMO) {
    const alerte = parseInt((demoDb.reglages.find((r) => r.cle === "alerte_jours") || {}).valeur || "60", 10);
    const retard = parseInt((demoDb.reglages.find((r) => r.cle === "carte_conducteur_retard_jours") || {}).valeur || "28", 10);
    const today = new Date();
    const rows = [];
    const pushIfDue = (chauffeurId, nom, typeDoc, detail, echeance) => {
      if (!echeance) return;
      const d = new Date(echeance);
      const joursRestants = Math.round((d - today) / 86400000);
      if (joursRestants > alerte) return;
      rows.push({
        chauffeur_id: chauffeurId, chauffeur: nom, type_document: typeDoc, detail,
        echeance, jours_restants: joursRestants, statut: joursRestants < 0 ? "expire" : "bientot",
      });
    };
    for (const ch of demoDb.chauffeurs) {
      if (ch.date_sortie) continue;
      for (const pc of demoDb.permis_categories.filter((p) => p.chauffeur_id === ch.id)) {
        pushIfDue(ch.id, ch.nom, "Permis " + pc.categorie, pc.categorie, pc.validite);
      }
      const fco = demoDb.fco.find((f) => f.chauffeur_id === ch.id);
      if (fco) pushIfDue(ch.id, ch.nom, "FCO / code 95", fco.numero, fco.expiration);
      const cc = demoDb.carte_conducteur.find((c) => c.chauffeur_id === ch.id);
      if (cc) {
        pushIfDue(ch.id, ch.nom, "Carte conducteur", cc.numero, cc.expiration);
        if (cc.dernier_telechargement) {
          const retardJours = Math.round((today - new Date(cc.dernier_telechargement)) / 86400000);
          if (retardJours > retard) {
            rows.push({
              chauffeur_id: ch.id, chauffeur: ch.nom, type_document: "Carte conducteur",
              detail: "dernier téléchargement", echeance: cc.dernier_telechargement,
              jours_restants: -retardJours, statut: "retard",
            });
          }
        }
      }
      for (const c of demoDb.caces.filter((c) => c.chauffeur_id === ch.id)) {
        pushIfDue(ch.id, ch.nom, "CACES " + c.type, (c.categories || []).join(", "), c.expiration);
      }
    }
    return rows;
  }
  return live.rpcAlertesDocuments();
}

export async function uploadChauffeurDoc(path, file) {
  if (DEMO) return path; // simulateur : pas d'upload réel, juste la clé renvoyée.
  return live.uploadChauffeurDoc(path, file);
}
export async function signedUrlChauffeurDoc(path) {
  if (DEMO) return "about:blank#demo-" + encodeURIComponent(path);
  return live.signedUrlChauffeurDoc(path);
}

/* --------------------------------------------------------------- bon-worker === */
export async function workerAlertes() {
  if (DEMO) {
    return {
      camions: demoDb.camions.filter((c) => c.actif),
      chauffeurs: demoDb.chauffeurs.filter((c) => !c.date_sortie),
      documents: await rpcAlertesDocuments(),
    };
  }
  return live.workerAlertes();
}
export async function workerEnvoiGroupe(lvIds) {
  if (DEMO) {
    return {
      declenche_par: "bouton", auto: false, documenso: "hors_perimetre_beta",
      lv: demoDb.lettres_voiture.filter((lv) => lvIds.map(String).includes(String(lv.id))),
    };
  }
  return live.workerEnvoiGroupe(lvIds);
}
export async function workerChauffeurDepart(chauffeurId) {
  if (DEMO) {
    const row = byId(demoDb.chauffeurs, chauffeurId);
    if (row) row.date_sortie = todayIso();
    demoDb.permis = demoDb.permis.filter((p) => String(p.chauffeur_id) !== String(chauffeurId));
    demoDb.fco = demoDb.fco.filter((p) => String(p.chauffeur_id) !== String(chauffeurId));
    demoDb.carte_conducteur = demoDb.carte_conducteur.filter((p) => String(p.chauffeur_id) !== String(chauffeurId));
    demoDb.caces = demoDb.caces.filter((p) => String(p.chauffeur_id) !== String(chauffeurId));
    return { purges: [], storage_supprimes: 0 };
  }
  return live.workerChauffeurDepart(chauffeurId);
}
export async function workerDocumentSignedUrl(key) {
  if (DEMO) return { signed_url: "about:blank#demo-" + encodeURIComponent(key) };
  return live.workerDocumentSignedUrl(key);
}
export async function workerSignatureWarm(lvIds) {
  // beta.25 : préchauffe LOCALE du cache PDF (aucun document Documenso, aucun mail).
  if (DEMO) return { warmed: (lvIds || []).length };
  return live.workerSignatureWarm(lvIds);
}
export async function workerSignatureSurPlace(lvIds, signaturePng) {
  if (DEMO) {
    // beta.33 : la signature est dessinée dans l'appli ; en démo on confirme juste.
    return { mode: "sur_place", ok: true, lv_ids: lvIds,
      numeros: lvIds.map((id) => (byId(demoDb.lettres_voiture, id) || {}).numero || "#" + id) };
  }
  return live.workerSignatureSurPlace(lvIds, signaturePng);
}
export async function workerLvRecap(lvId) {
  if (DEMO) {
    const lv = byId(demoDb.lettres_voiture, lvId) || {};
    const cl = byId(demoDb.clients, lv.client_id) || {};
    return {
      lv: { numero: lv.numero || "#" + lvId, date: "11/11/2026",
        expediteur: cl.raison_sociale || "Client démo", destinataire: cl.raison_sociale || "Client démo",
        projets_aff: "Régie Franciliane", heures_aff: "7h00–16h00" },
      prestations: [{ libelle: "Jour de régie avec chauffeur", quantite_aff: "1", unite_aff: "jour", materiel: "20 t 8×4 bi-benne grue" }],
      tours: [{ chargement_nom: "Cemex · Ivry béton", chargement_adresse: "Quai Marcel Boyer, 94200 Ivry",
        dechargement_nom: "Veolia · Noisy", dechargement_adresse: "2 rue de la Plaine, 93160 Noisy",
        lignes: [{ nom: "Grave", quantite_aff: "12", unite_aff: "t" }] }],
    };
  }
  return live.workerLvRecap(lvId);
}
export async function workerSignatureCancel(lvIds) {
  if (DEMO) return { cancelled: lvIds };
  return live.workerSignatureCancel(lvIds);
}
export async function workerSignatureResend(lvIds) {
  if (DEMO) return { resent: true };
  return live.workerSignatureResend(lvIds);
}
export async function workerSignatureParMail(lvIds) {
  if (DEMO) {
    const first = byId(demoDb.lettres_voiture, lvIds[0]) || {};
    return { mode: "par_mail", document_id: 1234, contact_email: "contact@demo.test", lv_ids: lvIds, _demo: first };
  }
  return live.workerSignatureParMail(lvIds);
}
export async function workerSignatureSync(documentId) {
  if (DEMO) return { verifiees: 0, signees: 0 };
  return live.workerSignatureSync(documentId);
}
export async function workerLvPdf(lvId) {
  if (DEMO) {
    // En démo (captures), pas de worker : PDF 1 page VALIDE que la visionneuse
    // intégrée (pdf.js) sait rendre.
    const bin = atob(seed.DEMO_PDF_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "application/pdf" });
  }
  return live.workerLvPdf(lvId);
}

/* -------------------------------------------------------- Adresse (api-adresse) */
export async function searchAddress(query) {
  if (DEMO) {
    if (!query || query.trim().length < 2) return [];
    const needle = query.toLowerCase();
    const matches = seed.DEMO_ADDRESS_SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(needle));
    return matches.length ? matches : seed.DEMO_ADDRESS_SUGGESTIONS;
  }
  return live.searchAddress(query);
}
export async function reverseAddress(lat, lon) {
  if (DEMO) return seed.DEMO_ADDRESS_SUGGESTIONS[0];
  return live.reverseAddress(lat, lon);
}

/* ------------------------------------------------------------------------- RPC */
export async function rpcLvPoids(lvId) {
  if (DEMO) {
    const tours = demoDb.tours.filter((t) => String(t.lv_id) === String(lvId) && !t.deleted_at);
    const lv = byId(demoDb.lettres_voiture, lvId);
    const camion = lv ? byId(demoDb.camions, lv.camion_id) : null;
    const poidsVideT = camion ? (camion.poids_vide_kg || 0) / 1000 : 0;
    let chargementT = 0;
    let partiel = false;
    let nonComptees = 0;
    for (const t of tours) {
      for (const l of demoDb.tour_lignes.filter((l) => String(l.tour_id) === String(t.id))) {
        const art = byId(demoDb.articles, l.article_id);
        if (!l.quantite) continue;
        if (l.unite === "t") chargementT += l.quantite;
        else if (l.unite === "m3" && art && art.densite_t_m3) chargementT += l.quantite * art.densite_t_m3;
        else if (l.unite === "unite" && art && art.poids_unitaire_t) chargementT += l.quantite * art.poids_unitaire_t;
        else { partiel = true; nonComptees++; }
      }
    }
    const masseTotaleT = Math.round((poidsVideT + chargementT) * 1000) / 1000;
    const ptacT = camion ? (camion.ptac_kg || 0) / 1000 : null;
    const ratio = ptacT ? masseTotaleT / ptacT : null;
    const gauge = ratio == null ? "ok" : ratio >= 1.05 ? "danger" : ratio >= 1.0 ? "warn" : "ok";
    return {
      poids_vide_t: poidsVideT, chargement_t: chargementT, masse_totale_t: masseTotaleT,
      ptac_t: ptacT, ratio, gauge, poids_partiel: partiel, lignes_non_comptees: nonComptees,
    };
  }
  return live.rpcLvPoids(lvId);
}

export async function rpcPrefill(chauffeurId) {
  if (DEMO) {
    const ch = byId(demoDb.chauffeurs, chauffeurId);
    const lastLv = demoDb.lettres_voiture
      .filter((lv) => String(lv.chauffeur_id) === String(chauffeurId) && !lv.deleted_at)
      .sort((a, b) => (a.date_etablissement < b.date_etablissement ? 1 : -1))[0];
    return {
      camion_id: ch ? ch.camion_id : null,
      client_id: lastLv ? lastLv.client_id : null,
      projet_id: lastLv ? lastLv.projet_id : null,
      contact_id: lastLv ? lastLv.contact_id : null,
      lv_id: lastLv && lastLv.statut !== "signee" ? lastLv.id : null,
    };
  }
  return live.rpcPrefill(chauffeurId);
}

export async function rpcSitesPour(chauffeurId, clientId) {
  if (DEMO) {
    const sites = demoDb.sites.filter((s) => s.statut === "actif" && (!clientId || !s.client_id || String(s.client_id) === String(clientId)));
    return sites.map((s, i) => ({ id: s.id, nom: s.nom, adresse: s.adresse, source: s.client_id ? 2 : 3, rang: i + 1 }));
  }
  return live.rpcSitesPour(chauffeurId, clientId);
}

export async function rpcAdressesChantier(clientId) {
  if (DEMO) {
    const tours = (demoDb.tours || []).filter((t) => !t.deleted_at);
    const lvById = new Map((demoDb.lettres_voiture || []).map((l) => [l.id, l]));
    const usages = [];
    for (const t of tours) {
      const lv = lvById.get(t.lv_id) || {};
      for (const side of ["chargement", "dechargement"]) {
        const adr = t[side + "_adresse"];
        if (adr) usages.push({ adresse: adr, lat: t[side + "_lat"], lon: t[side + "_lon"], client_id: lv.client_id, derniere: t.created_at || new Date().toISOString(), nb: 1 });
      }
    }
    return usages;
  }
  return live.rpcAdressesChantier(clientId);
}

// beta.34 : lignes du dernier tour partant d'un lieu de chargement (site OU adresse).
export async function rpcDernierChargementLignes(siteId, adresse, excludeTourId) {
  if (DEMO) {
    const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
    const lvById = new Map((demoDb.lettres_voiture || []).map((l) => [l.id, l]));
    const candidats = (demoDb.tours || []).filter((t) => {
      if (t.deleted_at) return false;
      if (excludeTourId != null && String(t.id) === String(excludeTourId)) return false;
      const lv = lvById.get(t.lv_id);
      if (!lv || lv.deleted_at) return false;
      if (siteId != null && String(t.site_chargement_id) === String(siteId)) return true;
      if (adresse && t.chargement_adresse && norm(t.chargement_adresse) === norm(adresse)) return true;
      return false;
    });
    candidats.sort((a, b) => {
      const la = lvById.get(a.lv_id) || {}, lb = lvById.get(b.lv_id) || {};
      const da = String(la.date_etablissement || ""), db = String(lb.date_etablissement || "");
      if (da !== db) return db.localeCompare(da);
      const ca = String(la.created_at || ""), cb = String(lb.created_at || "");
      if (ca !== cb) return cb.localeCompare(ca);
      return (b.ordre || 0) - (a.ordre || 0) || (b.id || 0) - (a.id || 0);
    });
    const cible = candidats[0];
    if (!cible) return [];
    const artById = new Map((demoDb.articles || []).map((a) => [a.id, a]));
    return (demoDb.tour_lignes || [])
      .filter((l) => String(l.tour_id) === String(cible.id) && (l.article_id != null || l.quantite != null))
      .sort((a, b) => (a.id || 0) - (b.id || 0))
      .map((l) => ({
        article_id: l.article_id != null ? l.article_id : null,
        article_nom: (artById.get(l.article_id) || {}).nom || null,
        quantite: l.quantite != null ? l.quantite : null,
        unite: l.unite || null,
      }));
  }
  return live.rpcDernierChargementLignes(siteId, adresse, excludeTourId);
}

export async function rpcSiteDoublon(lat, lon, rayonM = 100.0) {
  if (DEMO) {
    return demoDb.sites
      .filter((s) => s.lat != null && s.lon != null)
      .map((s) => ({ id: s.id, nom: s.nom, distance_m: haversine(lat, lon, s.lat, s.lon) }))
      .filter((s) => s.distance_m <= rayonM);
  }
  return live.rpcSiteDoublon(lat, lon, rayonM);
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function rpcLvUndo(lvId) {
  if (DEMO) return { undone: false, reason: "demo" };
  return live.rpcLvUndo(lvId);
}
export async function rpcSetDerniereUnite(chauffeurId, articleId, unite) {
  if (DEMO) return;
  return live.rpcSetDerniereUnite(chauffeurId, articleId, unite);
}

export function todayIso() {
  return seed.todayIso();
}
