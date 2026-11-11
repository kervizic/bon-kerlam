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
