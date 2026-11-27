/* supabase-client.js — client Supabase configuré + helpers d'accès aux données.
 *
 * Module ES. Suppose que `vendor/supabase/supabase.js` (UMD, classique) a déjà
 * défini `window.supabase.createClient` AVANT que ce module ne s'exécute — c'est
 * garanti par l'ordre de chargement dans index.html (config.js -> vendor -> app.js).
 *
 * Le client se connecte sur le schéma PostgREST "api" (vues security_invoker +
 * RPC) décrit par supabase/migrations/0005_api.sql. La RLS réelle vit dans le
 * schéma "bon" (0004_rls.sql) et s'applique via ces vues.
 */

import { photoPaths, rowOf, isDuplicate } from "./photo-queue.js";

const cfg = window.BON_CFG || {};

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  // Le vendor n'a pas pu se charger (placeholder, erreur réseau, CSP...).
  // On ne jette pas tout de suite : on laisse app.js afficher un message clair
  // plutôt qu'un écran blanc.
  console.error(
    "[supabase-client] window.supabase.createClient indisponible — " +
      "vérifier assets/vendor/supabase/supabase.js"
  );
}

export const sb = window.supabase && window.supabase.createClient
  ? window.supabase.createClient(cfg.API_URL, cfg.ANON_KEY, {
      db: { schema: "api" },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

function requireClient() {
  if (!sb) throw new Error("Client Supabase non initialisé (config.js manquant ou invalide).");
  return sb;
}

// ----------------------------------------------------------------- Auth -----

export async function getSession() {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  return requireClient().auth.onAuthStateChange(callback);
}

export async function signInWithGoogle() {
  return requireClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/" },
  });
}

export async function signOut() {
  // beta.32 : scope local -> ne déconnecte QUE cet appareil (les autres sessions et
  // les passkeys Face ID restent valides). Évite aussi de révoquer le refresh token
  // côté serveur (plus rapide, pas d'appel réseau bloquant).
  return requireClient().auth.signOut({ scope: "local" });
}

// Deuxième méthode de connexion : code à 6 chiffres envoyé par e-mail (OTP).
// `shouldCreateUser: true` autorise la création du compte auth au premier
// envoi ; l'autorisation réelle reste pilotée par la liste blanche
// bon.utilisateurs (cf. getProfil) — un compte auth créé sans y figurer
// tombera sur l'écran "Accès non autorisé" comme avec Google.
export async function sendEmailOtp(email) {
  const { error } = await requireClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyEmailOtp(email, code) {
  const { data, error } = await requireClient().auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (error) throw error;
  return data; // { session, user }
}

// --------------------------------------------- Passkeys / Face ID (beta.27) --
// WebAuthn natif Supabase (GoTrue v2.190, supabase-js 2.119). Une passkey ne peut
// être enregistrée que par un utilisateur DÉJÀ connecté : elle n'ouvre jamais un
// compte hors liste blanche.

// Le navigateur gère-t-il WebAuthn (et de préférence un authentificateur de
// plateforme = Face ID / Touch ID / Windows Hello) ?
export function webauthnSupported() {
  return typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    !!(navigator.credentials && typeof navigator.credentials.create === "function");
}

// Y a-t-il un authentificateur de plateforme (Face ID / Touch ID) disponible ?
export async function platformAuthenticatorAvailable() {
  if (!webauthnSupported() || !window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    return false;
  }
}

// Enregistre une passkey pour l'utilisateur connecté (cérémonie WebAuthn complète).
export async function registerPasskey() {
  const { data, error } = await requireClient().auth.registerPasskey();
  if (error) throw error;
  return data;
}

// Connexion par passkey (cérémonie complète -> session).
export async function signInWithPasskey() {
  const { data, error } = await requireClient().auth.signInWithPasskey();
  if (error) throw error;
  return data; // { session, user }
}

export async function listPasskeys() {
  const { data, error } = await requireClient().auth.passkey.list();
  if (error) throw error;
  return data || [];
}

export async function deletePasskey(passkeyId) {
  const { error } = await requireClient().auth.passkey.delete({ passkeyId });
  if (error) throw error;
}

// --------------------------------------------------------------- Profil -----

// api.profil : vide (aucune ligne) si l'e-mail connecté n'est pas sur la liste
// blanche bon.utilisateurs (actif=true, role<>'desactive'). C'est le signal
// utilisé par app.js pour afficher l'écran "Accès non autorisé".
export async function getProfil() {
  const { data, error } = await requireClient().from("profil").select("*").maybeSingle();
  if (error) throw error;
  return data; // null => non autorisé
}

// --------------------------------------------------------- Lettres de voiture --

export async function getLvDuJour(chauffeurId, date = todayIso()) {
  const { data, error } = await requireClient()
    .from("lettres_voiture")
    .select("*")
    .eq("chauffeur_id", chauffeurId)
    .eq("date_etablissement", date)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLv(lvId) {
  const { data, error } = await requireClient().from("lettres_voiture").select("*").eq("id", lvId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createLv(fields) {
  const { data, error } = await requireClient().from("lettres_voiture").insert(fields).select().single();
  if (error) throw error;
  return data;
}

export async function updateLv(lvId, patch) {
  const { data, error } = await requireClient().from("lettres_voiture").update(patch).eq("id", lvId).select().maybeSingle();
  if (error) throw error;
  return data;
}

// --------------------------------------------------------------------- Tours --

export async function getTours(lvId) {
  const { data, error } = await requireClient()
    .from("tours")
    .select("*")
    .eq("lv_id", lvId)
    .is("deleted_at", null)
    .order("ordre", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createTour(fields) {
  const { data, error } = await requireClient().from("tours").insert(fields).select().single();
  if (error) throw error;
  return data;
}

export async function updateTour(tourId, patch) {
  const { data, error } = await requireClient().from("tours").update(patch).eq("id", tourId).select().maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteTour(tourId) {
  const { error } = await requireClient().from("tours").update({ deleted_at: new Date().toISOString() }).eq("id", tourId);
  if (error) throw error;
}

// ------------------------------------------------------------- Lignes d'article --

export async function getLignes(tourId) {
  const { data, error } = await requireClient().from("tour_lignes").select("*").eq("tour_id", tourId).order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createLigne(fields) {
  const { data, error } = await requireClient().from("tour_lignes").insert(fields).select().single();
  if (error) throw error;
  return data;
}

export async function updateLigne(ligneId, patch) {
  const { data, error } = await requireClient().from("tour_lignes").update(patch).eq("id", ligneId).select().maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteLigne(ligneId) {
  const { error } = await requireClient().from("tour_lignes").delete().eq("id", ligneId);
  if (error) throw error;
}

// ------------------------------------------------------------------ Référentiels --

export async function listSites() {
  const { data, error } = await requireClient().from("sites").select("*").eq("statut", "actif").order("nom");
  if (error) throw error;
  return data || [];
}

export async function listArticles() {
  const { data, error } = await requireClient().from("articles").select("*").eq("actif", true).order("nom");
  if (error) throw error;
  return data || [];
}

export async function listCamions() {
  const { data, error } = await requireClient().from("camions").select("*").eq("actif", true).order("immatriculation");
  if (error) throw error;
  return data || [];
}

export async function listClients() {
  const { data, error } = await requireClient().from("clients").select("*").eq("actif", true).order("raison_sociale");
  if (error) throw error;
  return data || [];
}

export async function listProjets(clientId) {
  let q = requireClient().from("projets").select("*").order("nom");
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listContacts(clientId) {
  let q = requireClient().from("contacts").select("*").order("nom");
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------- CRUD référentiels --
// Toutes ces fonctions suivent le même schéma : insert/update sur la vue `api.*`
// correspondante, qui applique la RLS du schéma `bon` (cf. 0004_rls.sql). Les
// écrans bureau (app.js) les appellent via autosave champ-par-champ.

function makeCrud(table) {
  return {
    create: async (fields) => {
      const { data, error } = await requireClient().from(table).insert(fields).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, patch) => {
      const { data, error } = await requireClient().from(table).update(patch).eq("id", id).select().maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}

const crudProjets = makeCrud("projets");
export const createProjet = crudProjets.create;
export const updateProjet = crudProjets.update;

// beta.30 : liaison N-N lettre <-> projets (api.lv_projets). Lecture + (dé)liaison.
export async function listLvProjets(lvId) {
  const { data, error } = await requireClient().from("lv_projets").select("projet_id").eq("lv_id", lvId);
  if (error) throw error;
  return (data || []).map((r) => r.projet_id);
}
export async function linkLvProjet(lvId, projetId) {
  const { error } = await requireClient().from("lv_projets").upsert({ lv_id: lvId, projet_id: projetId }, { onConflict: "lv_id,projet_id" });
  if (error) throw error;
}
export async function unlinkLvProjet(lvId, projetId) {
  const { error } = await requireClient().from("lv_projets").delete().eq("lv_id", lvId).eq("projet_id", projetId);
  if (error) throw error;
}

const crudClients = makeCrud("clients");
export const createClient = crudClients.create;
export const updateClient = crudClients.update;

const crudContacts = makeCrud("contacts");
export const createContact = crudContacts.create;
export const updateContact = crudContacts.update;
export async function deleteContact(id) {
  const { error } = await requireClient().from("contacts").delete().eq("id", id);
  if (error) throw error;
}

const crudSites = makeCrud("sites");
export const createSite = crudSites.create;
export const updateSite = crudSites.update;

// ------------------------------------------------------ beta.22 : société -> adresses
export async function listClientAdresses(clientId) {
  let q = requireClient().from("client_adresses").select("*").eq("actif", true)
    .order("is_principale", { ascending: false }).order("libelle");
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
const crudClientAdresses = makeCrud("client_adresses");
export const createClientAdresse = crudClientAdresses.create;
export const updateClientAdresse = crudClientAdresses.update;
export async function deleteClientAdresse(id) {
  const { error } = await requireClient().from("client_adresses").delete().eq("id", id);
  if (error) throw error;
}

export async function listSiteSocietes() {
  const { data, error } = await requireClient().from("site_societes").select("*")
    .eq("actif", true).order("nom");
  if (error) throw error;
  return data || [];
}
const crudSiteSocietes = makeCrud("site_societes");
export const createSiteSociete = crudSiteSocietes.create;
export const updateSiteSociete = crudSiteSocietes.update;

// Fusion réversible (RPC SECURITY DEFINER) + détection de doublons.
export async function rpcFusionnerClients(gardeId, fusionnesIds) {
  const { data, error } = await requireClient().rpc("fusionner_clients",
    { p_garde: gardeId, p_fusionnes: fusionnesIds });
  if (error) throw error;
  return data;
}
export async function rpcFusionnerSites(gardeId, fusionnesIds) {
  const { data, error } = await requireClient().rpc("fusionner_sites",
    { p_garde: gardeId, p_fusionnes: fusionnesIds });
  if (error) throw error;
  return data;
}
export async function rpcFusionnerSiteSocietes(gardeId, fusionnesIds) {
  const { data, error } = await requireClient().rpc("fusionner_site_societes",
    { p_garde: gardeId, p_fusionnes: fusionnesIds });
  if (error) throw error;
  return data;
}
export async function rpcFusionAnnuler(fusionId) {
  const { data, error } = await requireClient().rpc("fusion_annuler", { p_fusion_id: fusionId });
  if (error) throw error;
  return data;
}
export async function listDoublonsClients() {
  const { data, error } = await requireClient().from("doublons_clients").select("*");
  if (error) throw error;
  return data || [];
}
export async function listDoublonsSites() {
  const { data, error } = await requireClient().from("doublons_sites").select("*");
  if (error) throw error;
  return data || [];
}
export async function listFusions({ type, gardeId } = {}) {
  let q = requireClient().from("fusions").select("*").is("annulee_at", null).order("id", { ascending: false });
  if (type) q = q.eq("type", type);
  if (gardeId) q = q.eq("garde_id", gardeId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

const crudCamions = makeCrud("camions");
export const createCamion = crudCamions.create;
export const updateCamion = crudCamions.update;

const crudChauffeurs = makeCrud("chauffeurs");
export const createChauffeur = crudChauffeurs.create;
export const updateChauffeur = crudChauffeurs.update;

export async function listChauffeurs() {
  const { data, error } = await requireClient().from("chauffeurs").select("*").order("nom");
  if (error) throw error;
  return data || [];
}

const crudArticles = makeCrud("articles");
export const createArticle = crudArticles.create;
export const updateArticle = crudArticles.update;

export async function listArticlesAll() {
  // Variante de listArticles() sans filtre actif=true : utile pour l'écran
  // bureau "Articles" qui doit aussi pouvoir réactiver un article désactivé.
  const { data, error } = await requireClient().from("articles").select("*").order("nom");
  if (error) throw error;
  return data || [];
}

// ------------------------------------------------------- Prestations (H) --
// Catalogue commun bon.prestations (comme les articles) + matériels + lignes de
// prestation d'une lettre (bon.lv_prestations, rattachées directement à la LV).

export async function listPrestations() {
  const { data, error } = await requireClient().from("prestations").select("*").eq("actif", true).order("libelle");
  if (error) throw error;
  return data || [];
}
export async function listPrestationsAll() {
  const { data, error } = await requireClient().from("prestations").select("*").order("libelle");
  if (error) throw error;
  return data || [];
}
const crudPrestations = makeCrud("prestations");
export const createPrestation = crudPrestations.create;
export const updatePrestation = crudPrestations.update;

export async function listMateriels() {
  const { data, error } = await requireClient().from("materiels").select("*").eq("actif", true).order("libelle");
  if (error) throw error;
  return data || [];
}

export async function getPrestationsLv(lvId) {
  const { data, error } = await requireClient()
    .from("lv_prestations")
    .select("*")
    .eq("lv_id", lvId)
    .order("ordre", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}
export async function createPrestationLigne(fields) {
  const { data, error } = await requireClient().from("lv_prestations").insert(fields).select().single();
  if (error) throw error;
  return data;
}
export async function updatePrestationLigne(id, patch) {
  const { data, error } = await requireClient().from("lv_prestations").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
export async function deletePrestationLigne(id) {
  const { error } = await requireClient().from("lv_prestations").delete().eq("id", id);
  if (error) throw error;
}

// Report automatique : première prestation de la dernière lettre du chauffeur.
export async function rpcDernierePrestation(chauffeurId) {
  const { data, error } = await requireClient().rpc("derniere_prestation", { p_chauffeur_id: chauffeurId });
  if (error) throw error;
  return data; // { prestation_id, unite, quantite, materiel_id } ou null
}

export async function rpcDerniereQuantiteEstimee(chauffeurId, clientId) {
  const { data, error } = await requireClient().rpc("derniere_quantite_estimee",
    { p_chauffeur_id: chauffeurId, p_client_id: clientId });
  if (error) throw error;
  return data; // { quantite, unite } ou null
}

// Pas de fonction api.fusionner_article() exposée côté SQL (cf. migrations) :
// on signale clairement l'absence plutôt que de faire semblant. L'écran
// Articles affiche alors un stub bureau-only (cf. app.js, handleFusionArticle).
export async function rpcFusionnerArticle() {
  throw new Error("RPC_ABSENTE");
}

export async function listUtilisateurs() {
  const { data, error } = await requireClient().from("utilisateurs").select("*").order("email");
  if (error) throw error;
  return data || [];
}
const crudUtilisateurs = makeCrud("utilisateurs");
export const createUtilisateur = crudUtilisateurs.create;
export const updateUtilisateur = crudUtilisateurs.update;

export async function listReglages() {
  const { data, error } = await requireClient().from("reglages").select("*").order("cle");
  if (error) throw error;
  return data || [];
}
export async function upsertReglage(cle, valeur) {
  const { data, error } = await requireClient().from("reglages").update({ valeur }).eq("cle", cle).select().maybeSingle();
  if (error) throw error;
  return data;
}

// Toutes les lettres de voiture (écran "LV"), et celles préparées par le bureau
// (écran "Planning" : preparee=true, pas encore de tour).
export async function listLettresVoiture({ query, date, statut } = {}) {
  let q = requireClient().from("lettres_voiture").select("*").is("deleted_at", null);
  // Lettres annulées masquées des listes (numéro conservé en base, cf. 0017).
  if (statut) q = q.eq("statut", statut);
  else q = q.neq("statut", "annulee");
  if (date) q = q.eq("date_etablissement", date);
  q = q.order("date_etablissement", { ascending: false }).order("id", { ascending: false }).limit(200);
  const { data, error } = await q;
  if (error) throw error;
  let rows = data || [];
  if (query) {
    const needle = query.toLowerCase();
    rows = rows.filter((lv) =>
      (lv.numero || "").toLowerCase().includes(needle) ||
      (lv.expediteur || "").toLowerCase().includes(needle) ||
      (lv.destinataire || "").toLowerCase().includes(needle)
    );
  }
  return rows;
}

export async function listPlanningLv() {
  const { data, error } = await requireClient()
    .from("lettres_voiture")
    .select("*")
    .eq("preparee", true)
    .is("deleted_at", null)
    .neq("statut", "annulee")
    .order("date_etablissement", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Corbeille : lettres mises au rebut dans les 30 derniers jours (vue api.lv_corbeille).
export async function listCorbeille() {
  const { data, error } = await requireClient()
    .from("lv_corbeille")
    .select("*")
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Suppression / annulation (0017). Brouillon sans numéro -> corbeille ; lettre
// numérotée non signée -> statut « annulée » + motif ; lettre signée -> refus serveur.
export async function rpcLvSupprimer(lvId, categorie, motif) {
  const { data, error } = await requireClient().rpc("lv_supprimer", {
    p_lv_id: lvId, p_categorie: categorie ?? null, p_motif: motif ?? null,
  });
  if (error) throw error;
  return data;
}

export async function rpcLvRestaurer(lvId) {
  const { data, error } = await requireClient().rpc("lv_restaurer", { p_lv_id: lvId });
  if (error) throw error;
  return data;
}

// Suppression GROUPÉE d'une sélection (0021). Applique par lot : brouillon ->
// corbeille, numérotée non signée -> annulée, signée -> ignorée. Renvoie le
// récapitulatif { corbeille, annulee, ignore_signee, ignore_autre }.
export async function rpcLvSupprimerLot(lvIds, categorie, motif) {
  const { data, error } = await requireClient().rpc("lv_supprimer_lot", {
    p_lv_ids: lvIds, p_categorie: categorie ?? null, p_motif: motif ?? null,
  });
  if (error) throw error;
  return data;
}

// Mémoire des créneaux horaires : créneaux de la dernière lettre du chauffeur.
export async function rpcDernieresHeures(chauffeurId) {
  const { data, error } = await requireClient().rpc("dernieres_heures", { p_chauffeur_id: chauffeurId });
  if (error) throw error;
  return data || null;
}

// --------------------------------------------------- Documents réglementaires --
// Bureau uniquement (RLS serveur, cf. 0011_driver_documents.sql). Ces fonctions
// renvoient simplement vide/erreur pour un chauffeur — à l'app de ne pas planter.

export async function getPermis(chauffeurId) {
  const { data, error } = await requireClient().from("permis").select("*").eq("chauffeur_id", chauffeurId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function upsertPermis(chauffeurId, patch) {
  const existing = await getPermis(chauffeurId).catch(() => null);
  if (existing) {
    const { data, error } = await requireClient().from("permis").update(patch).eq("chauffeur_id", chauffeurId).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  const { data, error } = await requireClient().from("permis").insert({ chauffeur_id: chauffeurId, ...patch }).select().single();
  if (error) throw error;
  return data;
}

export async function listPermisCategories(chauffeurId) {
  const { data, error } = await requireClient().from("permis_categories").select("*").eq("chauffeur_id", chauffeurId).order("categorie");
  if (error) throw error;
  return data || [];
}
export async function createPermisCategorie(chauffeurId, categorie, validite) {
  const { data, error } = await requireClient().from("permis_categories").insert({ chauffeur_id: chauffeurId, categorie, validite }).select().single();
  if (error) throw error;
  return data;
}
export async function updatePermisCategorie(id, patch) {
  const { data, error } = await requireClient().from("permis_categories").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
export async function deletePermisCategorie(id) {
  const { error } = await requireClient().from("permis_categories").delete().eq("id", id);
  if (error) throw error;
}

export async function getFco(chauffeurId) {
  const { data, error } = await requireClient().from("fco").select("*").eq("chauffeur_id", chauffeurId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function upsertFco(chauffeurId, patch) {
  const existing = await getFco(chauffeurId).catch(() => null);
  if (existing) {
    const { data, error } = await requireClient().from("fco").update(patch).eq("chauffeur_id", chauffeurId).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  const { data, error } = await requireClient().from("fco").insert({ chauffeur_id: chauffeurId, ...patch }).select().single();
  if (error) throw error;
  return data;
}

export async function getCarteConducteur(chauffeurId) {
  const { data, error } = await requireClient().from("carte_conducteur").select("*").eq("chauffeur_id", chauffeurId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function upsertCarteConducteur(chauffeurId, patch) {
  const existing = await getCarteConducteur(chauffeurId).catch(() => null);
  if (existing) {
    const { data, error } = await requireClient().from("carte_conducteur").update(patch).eq("chauffeur_id", chauffeurId).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  const { data, error } = await requireClient().from("carte_conducteur").insert({ chauffeur_id: chauffeurId, ...patch }).select().single();
  if (error) throw error;
  return data;
}

export async function listCaces(chauffeurId) {
  const { data, error } = await requireClient().from("caces").select("*").eq("chauffeur_id", chauffeurId).order("id");
  if (error) throw error;
  return data || [];
}
export async function createCaces(chauffeurId, fields) {
  const { data, error } = await requireClient().from("caces").insert({ chauffeur_id: chauffeurId, ...fields }).select().single();
  if (error) throw error;
  return data;
}
export async function updateCaces(id, patch) {
  const { data, error } = await requireClient().from("caces").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
export async function deleteCaces(id) {
  const { error } = await requireClient().from("caces").delete().eq("id", id);
  if (error) throw error;
}

export async function rpcAlertesDocuments() {
  const { data, error } = await requireClient().rpc("alertes_documents");
  if (error) throw error;
  return data || [];
}

// ------------------------------------------------------------- Storage (scans) --
const DOCS_BUCKET = "chauffeur-docs";

export async function uploadChauffeurDoc(path, file) {
  const { data, error } = await requireClient().storage.from(DOCS_BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  return data && data.path;
}

export async function signedUrlChauffeurDoc(path, expiresInSec = 120) {
  const { data, error } = await requireClient().storage.from(DOCS_BUCKET).createSignedUrl(path, expiresInSec);
  if (error) throw error;
  return data && data.signedUrl;
}

// ------------------------------------------------ Photos de ligne (beta.35) --
// Bucket PRIVÉ ; lecture par URL signées courtes. L'envoi est idempotent (l'id de
// la photo est aussi son nom de fichier) : un doublon n'est pas une erreur.
const PHOTOS_BUCKET = "photos-lignes";

export async function listLignePhotos(lvId) {
  const { data, error } = await requireClient()
    .from("ligne_photos").select("*").eq("lv_id", lvId).order("taken_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function uploadLignePhoto(item) {
  const { path, thumbPath } = photoPaths(item.lvId, item.ligneId, item.id);
  const bucket = requireClient().storage.from(PHOTOS_BUCKET);
  for (const [p, blob] of [[path, item.blob], [thumbPath, item.thumb]]) {
    const { error } = await bucket.upload(p, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
    if (error && !isDuplicate(error)) throw error;
  }
  const { error } = await requireClient().from("ligne_photos").insert(rowOf(item));
  if (error && !isDuplicate(error)) throw error;
}

export async function deleteLignePhoto(id) {
  const { data, error } = await requireClient().from("ligne_photos").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw Object.assign(new Error("Suppression refusée."), { code: "42501" });
}

/** { chemin: URL signée } pour une liste de chemins (une seule requête). */
export async function signedUrlsLignePhotos(paths, expiresInSec = 600) {
  if (!paths.length) return {};
  const { data, error } = await requireClient().storage.from(PHOTOS_BUCKET).createSignedUrls(paths, expiresInSec);
  if (error) throw error;
  const out = {};
  for (const r of data || []) if (r && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
}

// --------------------------------------------------------------- bon-worker ----
// `/worker/*` est proxifié même-origine par nginx (cf. deploy/nginx/bon.kerlam.fr.conf) :
// un simple fetch relatif suffit, pas besoin de CORS. Ces endpoints exigent
// actuellement un jeton IA dédié côté serveur (X-AI-Token, cf. worker/app/auth.py) —
// hors périmètre de ce front : on tente l'appel avec le jeton de session Supabase
// en Authorization, et on échoue proprement (message clair) si le serveur refuse.
async function callWorker(path, { method = "GET", body } = {}) {
  let authHeader = {};
  try {
    const session = await getSession();
    if (session && session.access_token) authHeader = { Authorization: `Bearer ${session.access_token}` };
  } catch (e) {
    /* ignore : on tente sans jeton plutôt que de bloquer l'appel */
  }
  const res = await fetch(`/worker${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeader },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail || ""; } catch (e) {}
    throw new Error(`bon-worker ${res.status}${detail ? " — " + detail : ""}`);
  }
  return res.json();
}

export async function workerAlertes() {
  return callWorker("/alertes");
}
export async function workerEnvoiGroupe(lvIds) {
  return callWorker("/signature/envoi-groupe", { method: "POST", body: { lv_ids: lvIds } });
}
export async function workerSignatureSurPlace(lvIds, signaturePng) {
  return callWorker("/signature/sur-place", { method: "POST", body: { lv_ids: lvIds, signature_png: signaturePng } });
}
export async function workerSignatureCancel(lvIds) {
  return callWorker("/signature/cancel", { method: "POST", body: { lv_ids: lvIds } });
}
export async function workerSignatureResend(lvIds) {
  return callWorker("/signature/resend", { method: "POST", body: { lv_ids: lvIds } });
}
export async function workerSignatureParMail(lvIds) {
  return callWorker("/signature/par-mail", { method: "POST", body: { lv_ids: lvIds } });
}
export async function workerLvRecap(lvId) {
  return callWorker(`/lv/${lvId}/recap`);
}
export async function workerSignatureSync(documentId) {
  const body = documentId != null ? { document_id: documentId } : {};
  return callWorker("/signature/sync", { method: "POST", body });
}
export async function workerSignatureWarm(lvIds) {
  return callWorker("/signature/warm", { method: "POST", body: { lv_ids: lvIds } });
}
export async function workerChauffeurDepart(chauffeurId) {
  return callWorker(`/chauffeur/${chauffeurId}/depart`, { method: "POST" });
}
export async function workerDocumentSignedUrl(key, expires = 120) {
  return callWorker(`/document/signed-url?key=${encodeURIComponent(key)}&expires=${expires}`);
}

// PDF officiel de la lettre de voiture, généré par le worker (WeasyPrint) et
// authentifié par le jeton de session Supabase. Renvoie un Blob application/pdf.
export async function workerLvPdf(lvId) {
  let authHeader = {};
  try {
    const session = await getSession();
    if (session && session.access_token) authHeader = { Authorization: `Bearer ${session.access_token}` };
  } catch (e) { /* on tente sans jeton : le serveur refusera proprement */ }
  const res = await fetch(`/worker/lv/${lvId}/pdf`, { method: "POST", headers: authHeader });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail || ""; } catch (e) {}
    throw new Error(`bon-worker ${res.status}${detail ? " — " + detail : ""}`);
  }
  return res.blob();
}

// -------------------------------------------------------- Adresse (api-adresse) --
// api-adresse.data.gouv.fr est autorisée par la CSP (connect-src) : cf. front/nginx.conf.
export async function searchAddress(query, limit = 5) {
  if (!query || query.trim().length < 3) return [];
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("api-adresse: " + res.status);
  const data = await res.json();
  return (data.features || []).map((f) => ({
    label: f.properties.label,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

export async function reverseAddress(lat, lon) {
  const url = `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("api-adresse: " + res.status);
  const data = await res.json();
  const f = (data.features || [])[0];
  if (!f) return null;
  return { label: f.properties.label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
}

// bon.my_chauffeur_id() n'est pas exposé en RPC api ; on retrouve la fiche
// chauffeur de l'utilisateur connecté via son e-mail (lecture ouverte à tout
// membre par la RLS, cf. 0004_rls.sql).
export async function getChauffeurByEmail(email) {
  if (!email) return null;
  const { data, error } = await requireClient()
    .from("chauffeurs")
    .select("*")
    .ilike("email", email)
    .eq("actif", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------------------- RPC --

export async function rpcLvPoids(lvId) {
  const { data, error } = await requireClient().rpc("lv_poids", { p_lv_id: lvId });
  if (error) throw error;
  return data; // jsonb: { poids_vide_t, chargement_t, masse_totale_t, ptac_t, ratio, gauge, poids_partiel, lignes_non_comptees }
}

export async function rpcPrefill(chauffeurId) {
  const { data, error } = await requireClient().rpc("prefill", { p_chauffeur_id: chauffeurId });
  if (error) throw error;
  return data;
}

export async function rpcSitesPour(chauffeurId, clientId) {
  const { data, error } = await requireClient().rpc("sites_pour", { p_chauffeur_id: chauffeurId, p_client_id: clientId });
  if (error) throw error;
  return data || [];
}

// beta.28 : adresses de chantier déjà utilisées (texte) pour un client, triées
// même client d'abord puis dernière utilisation. La RLS limite au périmètre visible.
export async function rpcAdressesChantier(clientId) {
  const { data, error } = await requireClient().rpc("adresses_chantier", { p_client_id: clientId ?? null });
  if (error) throw error;
  return data || [];
}

// beta.34 : lignes (article, quantité, unité) du DERNIER tour partant d'un lieu de
// chargement donné (site permanent OU adresse de chantier). Sert la reprise au
// choix du lieu de chargement. p_exclude_tour_id exclut le tour en cours d'édition.
// La RLS limite aux lettres visibles (hors corbeille ; signées incluses en lecture).
export async function rpcDernierChargementLignes(siteId, adresse, excludeTourId) {
  const { data, error } = await requireClient().rpc("dernier_chargement_lignes", {
    p_site_id: siteId != null ? siteId : null,
    p_adresse: adresse || null,
    p_exclude_tour_id: excludeTourId != null ? excludeTourId : null,
  });
  if (error) throw error;
  return data || [];
}

export async function rpcSiteDoublon(lat, lon, rayonM = 100.0) {
  const { data, error } = await requireClient().rpc("site_doublon", { p_lat: lat, p_lon: lon, p_rayon_m: rayonM });
  if (error) throw error;
  return data || [];
}

export async function rpcLvUndo(lvId) {
  const { data, error } = await requireClient().rpc("lv_undo", { p_lv_id: lvId });
  if (error) throw error;
  return data;
}

export async function rpcSetDerniereUnite(chauffeurId, articleId, unite) {
  const { error } = await requireClient().rpc("set_derniere_unite", {
    p_chauffeur_id: chauffeurId,
    p_article_id: articleId,
    p_unite: unite,
  });
  if (error) throw error;
}

// ------------------------------------------------------------------------ Utils --

export function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
