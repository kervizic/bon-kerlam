/* lv-visibility.js — filtrage des lettres de voiture selon la VUE active (beta.26).
 *
 * Décision Manu (17/11) : « En mode chauffeur, chaque personne ne voit que ses
 * bons. » La RLS reste l'autorité côté serveur (un compte bureau a le droit de
 * tout lire), mais l'INTERFACE en VUE CHAUFFEUR ne doit montrer QUE les lettres
 * dont l'utilisateur est propriétaire — y compris pour les comptes qui ont aussi
 * le rôle bureau et qui ont basculé en vue chauffeur. La VUE BUREAU reste
 * inchangée (toutes les lettres visibles selon la RLS).
 *
 * Propriété = owner_email, comparaison insensible à la casse. Fonctions pures,
 * sans dépendance, testables (cf. lv-visibility.test.mjs).
 */

// Vrai si `lv` appartient à l'utilisateur d'e-mail `email` (insensible à la casse).
export function ownsLettre(lv, email) {
  const owner = (lv && lv.owner_email ? String(lv.owner_email) : "").trim().toLowerCase();
  const me = (email ? String(email) : "").trim().toLowerCase();
  return owner !== "" && me !== "" && owner === me;
}

// Filtre une liste de lettres pour l'affichage selon la vue :
//  - vue "chauffeur" : uniquement les lettres de `email` (fail-closed : si pas
//    d'e-mail connu, on ne montre rien) ;
//  - toute autre vue (bureau) : liste inchangée.
export function filterLettresForView(rows, { mode, email } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (mode !== "chauffeur") return list.slice();
  return list.filter((lv) => ownsLettre(lv, email));
}
