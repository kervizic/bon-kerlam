/* demo-data.js — jeu de données FICTIF pour le mode démo (?demo=1).
 *
 * Aucune donnée réelle KERLAM ici : noms, immatriculations, clients et adresses
 * sont tous inventés, uniquement pour permettre des captures d'écran CI sans
 * backend joignable. Les tableaux ci-dessous sont mutables : les écrans bureau
 * (autosave, undo/redo, création) écrivent directement dedans en mémoire, pour
 * un rendu réaliste, sans jamais toucher le réseau.
 *
 * Convention : chaque table expose un tableau `TABLE` + un compteur d'id
 * `nextTableId()`. Les fonctions de lecture/écriture miroir de supabase-client.js
 * sont assemblées dans data.js (qui bascule dessus quand isDemoMode() === true).
 */

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function makeCounter(start) {
  let n = start;
  return () => ++n;
}

export const todayIso = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return () => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

/* ------------------------------------------------------------------ Camions */
const nextCamionId = makeCounter(6);
export const CAMIONS = [
  { id: 1, immatriculation: "GH-204-TY", type: "10 t benne", ptac_kg: 10000, poids_vide_kg: 4200, charge_utile_kg: 5800, volume_benne_m3: 6.5, ct_echeance: addDays(20), chrono_echeance: addDays(400), actif: true, materiel_id: 1 },
  { id: 2, immatriculation: "QL-812-ZX", type: "15 t bibenne grue", ptac_kg: 15000, poids_vide_kg: 6800, charge_utile_kg: 8200, volume_benne_m3: 9.0, ct_echeance: addDays(-5), chrono_echeance: addDays(300), actif: true, materiel_id: 2 },
  { id: 3, immatriculation: "RB-553-PV", type: "19 t ampliroll", ptac_kg: 19000, poids_vide_kg: 8300, charge_utile_kg: 10700, volume_benne_m3: 12.0, ct_echeance: addDays(120), chrono_echeance: addDays(45), actif: true, materiel_id: 4 },
  { id: 4, immatriculation: "SN-071-KD", type: "26 t porteur grue", ptac_kg: 26000, poids_vide_kg: 11200, charge_utile_kg: 14800, volume_benne_m3: 15.0, ct_echeance: addDays(200), chrono_echeance: addDays(180), actif: true, materiel_id: 3 },
  { id: 5, immatriculation: "TM-399-JH", type: "8 t plateau", ptac_kg: 8000, poids_vide_kg: 3500, charge_utile_kg: 4500, volume_benne_m3: 0, ct_echeance: addDays(250), chrono_echeance: addDays(250), actif: false, materiel_id: null },
];

/* ---------------------------------------------------------------- Chauffeurs */
const nextChauffeurId = makeCounter(5);
export const CHAUFFEURS = [
  { id: 1, nom: "Marc Dubreuil", tel: "06 11 22 33 44", email: "demo.chauffeur@kerlam.fr", camion_id: 1, fco_echeance: addDays(40), carte_echeance: addDays(500), nav_app: "google_maps", theme: "auto", actif: true, date_sortie: null },
  { id: 2, nom: "Fatou Diallo", tel: "06 22 33 44 55", email: "fatou.diallo@kerlam.fr", camion_id: 2, fco_echeance: addDays(-10), carte_echeance: addDays(300), nav_app: "waze", theme: "auto", actif: true, date_sortie: null },
  { id: 3, nom: "Hugo Lefèvre", tel: "06 33 44 55 66", email: "hugo.lefevre@kerlam.fr", camion_id: 3, fco_echeance: addDays(400), carte_echeance: addDays(20), nav_app: "google_maps", theme: "sombre", actif: true, date_sortie: null },
  { id: 4, nom: "Nadia Belkacem", tel: "06 44 55 66 77", email: "nadia.belkacem@kerlam.fr", camion_id: 4, fco_echeance: addDays(600), carte_echeance: addDays(700), nav_app: "apple_plans", theme: "auto", actif: true, date_sortie: null },
];

/* ------------------------------------------------------------- Clients / contacts */
const nextClientId = makeCounter(3);
export const CLIENTS = [
  { id: 1, raison_sociale: "Travaux Publics Chantereine", adresse: "12 avenue des Peupliers, 77400 Lagny-Démo", siren: "123 456 789", alias: null, actif: true },
  { id: 2, raison_sociale: "Groupe Valoris Environnement", adresse: "4 rue des Tanneries, 93160 Noisy-Démo", siren: "234 567 890", alias: "Valoris", actif: true },
  { id: 3, raison_sociale: "SARL Bétons de l'Est", adresse: "27 rue du Port, 93460 Gournay-Démo", siren: "345 678 901", alias: null, actif: true },
  // Alias de recherche (beta.17) : « jean » -> EJL, « svtp » -> Société Voirie…
  { id: 4, raison_sociale: "EJL (Jean Lefebvre)", adresse: "9 rue des Chantiers, 93160 Noisy-Démo", siren: "456 789 012", alias: "Jean Lefebvre", actif: true },
  { id: 5, raison_sociale: "Société Voirie de Travaux Publics (SVTP)", adresse: "3 allée du Dépôt, 77400 Lagny-Démo", siren: "567 890 123", alias: "SVTP", actif: true },
];

const nextContactId = makeCounter(3);
export const CONTACTS = [
  { id: 1, client_id: 1, nom: "Claire Fontaine", tel: "01 23 45 67 89", email: "claire.fontaine@tp-chantereine-demo.fr", fonction: "Conductrice de travaux", signataire: true },
  { id: 2, client_id: 2, nom: "Julien Masse", tel: "01 98 76 54 32", email: "julien.masse@valoris-demo.fr", fonction: "Responsable d'exploitation", signataire: true },
  { id: 3, client_id: 3, nom: "Sophie Rinaldi", tel: "01 11 22 33 44", email: "sophie.rinaldi@betons-est-demo.fr", fonction: "Assistante", signataire: false },
];

/* --------------------------------------------------------------------- Projets */
const nextProjetId = makeCounter(3);
export const PROJETS = [
  { id: 1, client_id: 1, nom: "Réfection voirie Chantereine", ref_contrat: "CTR-2026-014", ref_ordre_mission: "OM-014-A", ligne_regie: "Régie terrassement", tarif: 480.0, contact_id: 1, date_debut: addDays(-120), date_fin: addDays(60), statut: "actif" },
  { id: 2, client_id: 2, nom: "Évacuation déchets site Nord", ref_contrat: "CTR-2026-021", ref_ordre_mission: "OM-021-B", ligne_regie: "Régie évacuation", tarif: 520.0, contact_id: 2, date_debut: addDays(-30), date_fin: addDays(150), statut: "actif" },
  { id: 3, client_id: 3, nom: "Livraison centrale à béton", ref_contrat: "CTR-2025-098", ref_ordre_mission: "OM-098-C", ligne_regie: "Régie livraison", tarif: 410.0, contact_id: 3, date_debut: addDays(-400), date_fin: addDays(-10), statut: "termine" },
];

/* ----------------------------------------------------------------------- Sites */
const nextSiteId = makeCounter(5);
export const SITES = [
  { id: 1, nom: "Dépôt Démo Claye", adresse: "15 rue des Démonstrations, 77410 Claye-Démo", lat: 48.9465, lon: 2.7765, type: "depot", portee: "commun", client_id: null, statut: "actif", derniere_utilisation: addDays(-1) },
  { id: 2, nom: "Plateforme recyclage Démo", adresse: "6 rue Fictive, 77400 Lagny-Démo", lat: 48.8773, lon: 2.7050, type: "recyclage", portee: "commun", client_id: null, statut: "actif", derniere_utilisation: addDays(-2) },
  { id: 3, nom: "Chantier Chantereine Lot 3", adresse: "12 avenue des Peupliers, 77400 Lagny-Démo", lat: 48.8790, lon: 2.7110, type: "chantier", portee: "chantier", client_id: 1, statut: "actif", derniere_utilisation: addDays(-1) },
  { id: 4, nom: "Site Nord Valoris", adresse: "4 rue des Tanneries, 93160 Noisy-Démo", lat: 48.8460, lon: 2.5540, type: "chantier", portee: "chantier", client_id: 2, statut: "actif", derniere_utilisation: addDays(-3) },
  { id: 5, nom: "Centrale à béton Démo Gournay", adresse: "27 rue du Port, 93460 Gournay-Démo", lat: 48.8700, lon: 2.5850, type: "chantier", portee: "chantier", client_id: 3, statut: "termine", derniere_utilisation: addDays(-90) },
];

/* -------------------------------------------------------------------- Articles */
const nextArticleId = makeCounter(5);
export const ARTICLES = [
  { id: 1, nom: "Grave", commentaire_interne: "0/31,5 · granulométrie en commentaire interne uniquement", unites: ["t", "m3"], densite_t_m3: 1.8, poids_unitaire_t: null, actif: true },
  { id: 2, nom: "Terre végétale", commentaire_interne: "Vérifier humidité avant pesée", unites: ["t", "m3"], densite_t_m3: 1.4, poids_unitaire_t: null, actif: true },
  { id: 3, nom: "Enrobé à chaud 0/10", commentaire_interne: "Livraison avant 11h impérative (refroidissement)", unites: ["t"], densite_t_m3: null, poids_unitaire_t: null, actif: true },
  { id: 4, nom: "Bordure béton T2", commentaire_interne: "Vendue à l'unité, palette de 40", unites: ["unite"], densite_t_m3: null, poids_unitaire_t: 0.032, actif: true },
  { id: 5, nom: "DIB (déchets industriels banals)", commentaire_interne: null, unites: ["t", "m3", "unite"], densite_t_m3: null, poids_unitaire_t: null, actif: true },
];

/* ------------------------------------------------------------------ Matériels */
const nextMaterielId = makeCounter(5);
export const MATERIELS = [
  { id: 1, libelle: "15 t 6×4 bi-benne grue", actif: true },
  { id: 2, libelle: "20 t 8×4 bi-benne", actif: false },
  { id: 3, libelle: "20 t 8×4 bi-benne grue", actif: true },
  { id: 4, libelle: "20 t 8×4 ampliroll grue", actif: true },
  { id: 5, libelle: "Mini-pelle sur chenilles 2–2,8 t", actif: true },
];

/* ----------------------------------------------------------------- Prestations */
const nextPrestationId = makeCounter(5);
export const PRESTATIONS = [
  { id: 1, libelle: "Jour de régie avec chauffeur", unite_defaut: "jour", commentaire_interne: null, actif: true },
  { id: 2, libelle: "Heure supplémentaire jour", unite_defaut: "heure", commentaire_interne: null, actif: true },
  { id: 3, libelle: "Heure supplémentaire nuit", unite_defaut: "heure", commentaire_interne: null, actif: true },
  { id: 4, libelle: "Heure supplémentaire week-end", unite_defaut: "heure", commentaire_interne: null, actif: true },
  { id: 5, libelle: "Astreinte", unite_defaut: "unite", commentaire_interne: null, actif: true },
];

/* ---------------------------------------------------------------- Utilisateurs */
const nextUtilisateurId = makeCounter(5);
export const UTILISATEURS = [
  { id: 1, email: "demo.chauffeur@kerlam.fr", role: "chauffeur", roles: ["chauffeur"], nom: "Marc Dubreuil", actif: true },
  { id: 2, email: "demo.bureau@kerlam.fr", role: "bureau", roles: ["bureau"], nom: "Lucie Perrin", actif: true },
  { id: 3, email: "demo.directeur@kerlam.fr", role: "bureau", roles: ["bureau", "chauffeur"], nom: "Amine Cherif", actif: true },
  { id: 4, email: "fatou.diallo@kerlam.fr", role: "chauffeur", roles: ["chauffeur"], nom: "Fatou Diallo", actif: true },
  { id: 5, email: "ancien.compte@kerlam.fr", role: "desactive", roles: [], nom: "Compte désactivé", actif: false },
];

/* ------------------------------------------------------------------- Réglages */
export const REGLAGES = [
  { cle: "signature_envoi_auto", valeur: "false", libelle: "Envoi en signature : manuel (bouton) uniquement — jamais automatique" },
  { cle: "documenso_cc_contact", valeur: "contact@kerlam-demo.fr", libelle: "Copie des mails finaux Documenso à cette adresse" },
  { cle: "alerte_jours", valeur: "60", libelle: "Nombre de jours avant échéance déclenchant une alerte" },
  { cle: "carte_conducteur_retard_jours", valeur: "28", libelle: "Retard max de téléchargement de la carte conducteur" },
];

/* ---------------------------------------------- Documents réglementaires (démo) */
export const PERMIS = [
  { id: 1, chauffeur_id: 1, numero: "771234567D", visite_medicale: addDays(200), scan_recto: null, scan_verso: null },
  { id: 2, chauffeur_id: 2, numero: "772345678E", visite_medicale: addDays(10), scan_recto: null, scan_verso: null },
];
const nextPermisCatId = makeCounter(4);
export const PERMIS_CATEGORIES = [
  { id: 1, chauffeur_id: 1, categorie: "CE", validite: addDays(300) },
  { id: 2, chauffeur_id: 1, categorie: "B", validite: addDays(1200) },
  { id: 3, chauffeur_id: 2, categorie: "C", validite: addDays(-15) },
  { id: 4, chauffeur_id: 3, categorie: "CE", validite: addDays(500) },
];
export const FCO = [
  { id: 1, chauffeur_id: 1, numero: "FCO-99881", delivrance: addDays(-1600), expiration: addDays(40) },
  { id: 2, chauffeur_id: 2, numero: "FCO-99882", delivrance: addDays(-1900), expiration: addDays(-10) },
];
export const CARTE_CONDUCTEUR = [
  { id: 1, chauffeur_id: 1, numero: "FR0019988001", expiration: addDays(500), dernier_telechargement: addDays(-5) },
  { id: 2, chauffeur_id: 3, numero: "FR0019988003", expiration: addDays(20), dernier_telechargement: addDays(-40) },
];
const nextCacesId = makeCounter(2);
export const CACES = [
  { id: 1, chauffeur_id: 2, type: "R482", categories: ["C1", "F"], expiration: addDays(300) },
  { id: 2, chauffeur_id: 3, type: "R490", categories: ["Grue auxiliaire"], expiration: addDays(-3) },
];

/* ---------------------------------------------------------- Lettres de voiture */
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowIsoAt(hh, mm) {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

const nextLvId = makeCounter(3);
export const LETTRES_VOITURE = [
  {
    id: 1, numero: "KER-03041", date_etablissement: todayIso(), date_prise_en_charge: todayIso(),
    expediteur: "KERLAM", destinataire: "KERLAM", dest_identique: true,
    camion_id: 1, chauffeur_id: 1, client_id: 1, projet_id: 1, contact_id: 1, heures_regie: null,
    heures: [{ debut: "08:00", fin: "12:00" }, { debut: "13:00", fin: "17:00" }],
    statut: "en_cours", preparee: false, owner_email: "demo.chauffeur@kerlam.fr", deleted_at: null,
  },
  {
    id: 2, numero: "KER-03042", date_etablissement: todayIso(), date_prise_en_charge: todayIso(),
    expediteur: "KERLAM", destinataire: "KERLAM", dest_identique: true,
    camion_id: 2, chauffeur_id: 2, client_id: 1, projet_id: 1, contact_id: 1, heures_regie: null,
    heures: [{ debut: "06:45", fin: "15:15" }],
    statut: "a_signer", preparee: false, owner_email: "fatou.diallo@kerlam.fr", deleted_at: null,
  },
  {
    id: 3, numero: null, date_etablissement: addDays(1), date_prise_en_charge: null,
    expediteur: "KERLAM", destinataire: "KERLAM", dest_identique: true,
    camion_id: 3, chauffeur_id: 3, client_id: 1, projet_id: 1, contact_id: 1, heures_regie: null,
    heures: null,
    statut: "preparee", preparee: true, owner_email: "hugo.lefevre@kerlam.fr", deleted_at: null,
  },
];

const nextTourId = makeCounter(2);
export const TOURS = [
  { id: 1, lv_id: 1, ordre: 1, heure_depart: nowIsoAt(7, 45), gps_lat: null, gps_lon: null, site_chargement_id: 1, site_dechargement_id: 3, expediteur: null, destinataire: null, deleted_at: null },
  { id: 2, lv_id: 2, ordre: 1, heure_depart: nowIsoAt(7, 0), gps_lat: null, gps_lon: null, site_chargement_id: 4, site_dechargement_id: 2, expediteur: null, destinataire: null, deleted_at: null },
];

const nextLigneId = makeCounter(3);
export const TOUR_LIGNES = [
  { id: 1, tour_id: 1, article_id: 1, quantite: 3.5, unite: "t" },
  { id: 2, tour_id: 1, article_id: 2, quantite: 1, unite: "m3" },
  { id: 3, tour_id: 2, article_id: 4, quantite: 20, unite: "unite" },
];

/* ---------------------------------------------------- Prestations d'une lettre */
const nextLvPrestationId = makeCounter(2);
export const LV_PRESTATIONS = [
  { id: 1, lv_id: 1, prestation_id: 1, quantite: 1, unite: "jour", materiel_id: 1, ordre: 1 },
  { id: 2, lv_id: 2, prestation_id: 2, quantite: 2, unite: "heure", materiel_id: 2, ordre: 1 },
];

/* ------------------------------------------------------------------- Helpers */
export function nextId(kind) {
  switch (kind) {
    case "camion": return nextCamionId();
    case "chauffeur": return nextChauffeurId();
    case "client": return nextClientId();
    case "contact": return nextContactId();
    case "projet": return nextProjetId();
    case "site": return nextSiteId();
    case "article": return nextArticleId();
    case "materiel": return nextMaterielId();
    case "prestation": return nextPrestationId();
    case "lvPrestation": return nextLvPrestationId();
    case "utilisateur": return nextUtilisateurId();
    case "lv": return nextLvId();
    case "tour": return nextTourId();
    case "ligne": return nextLigneId();
    case "permisCategorie": return nextPermisCatId();
    case "caces": return nextCacesId();
    default: throw new Error("nextId: type inconnu " + kind);
  }
}

export function cloneSeed(v) {
  return clone(v);
}

export const DEMO_PROFILE = {
  id: 3,
  email: "demo.directeur@kerlam.fr",
  role: "bureau",
  roles: ["bureau", "chauffeur"],
  nom: "Amine Cherif (démo)",
  actif: true,
};

export const DEMO_CHAUFFEUR = CHAUFFEURS[0]; // Marc Dubreuil, aligné sur la LV n°1 de démo

export const DEMO_ADDRESS_SUGGESTIONS = [
  { label: "12 avenue des Peupliers, 77400 Lagny-Démo", lat: 48.879, lon: 2.711 },
  { label: "4 rue des Tanneries, 93160 Noisy-Démo", lat: 48.846, lon: 2.554 },
  { label: "27 rue du Port, 93460 Gournay-Démo", lat: 48.87, lon: 2.585 },
];
