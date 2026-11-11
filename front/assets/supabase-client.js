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
  return requireClient().auth.signOut();
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
