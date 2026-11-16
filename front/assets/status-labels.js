/* status-labels.js — libellés français des statuts de lettre de voiture (beta.9).
 * Jamais de code brut (« a_signer », « en_cours »…) affiché : on passe toujours
 * par statutLabel(). La classe CSS de la pastille reste le code brut (couleur).
 */
"use strict";

export const STATUT_LV_LABELS = {
  preparee: "Préparée",
  en_cours: "En cours",
  cloturee: "Clôturée",
  a_signer: "À signer",
  envoyee: "En attente de signature",
  en_attente_signature: "En attente de signature",
  signee: "Signée",
  facturee: "Facturée",
  annulee: "Annulée",
};

export function statutLabel(code) {
  if (!code) return "";
  return STATUT_LV_LABELS[code] || String(code);
}

/* Badge d'une lettre dans les listes : { label, cls } (cls = suffixe de classe
 * CSS `.badge-<cls>`). Règle défensive (beta.21, bug « Clôturée ») : une lettre
 * SANS numéro est TOUJOURS un brouillon, quel que soit son statut en base — on
 * n'affiche jamais « Clôturée » / « Préparée »… sur un brouillon. Le numéro
 * n'étant attribué qu'au premier tour, l'absence de numéro = brouillon. */
export function lvBadge(lv) {
  if (!lv || !lv.numero) return { label: "Brouillon", cls: "brouillon" };
  return { label: statutLabel(lv.statut), cls: lv.statut };
}
