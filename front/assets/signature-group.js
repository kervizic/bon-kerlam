/* signature-group.js — règle de groupage pour la signature (f).
 * On ne peut signer ensemble (une enveloppe) que des lettres partageant le même
 * contact signataire. Fonction pure, testée.
 */
"use strict";

/**
 * @param {Array<{id:number, contact_id:number|null, numero?:string}>} lvs
 * @returns {{ok:boolean, reason?:string, contactId?:number}}
 */
export function canGroupForSignature(lvs) {
  if (!lvs || lvs.length === 0) {
    return { ok: false, reason: "Aucune lettre sélectionnée." };
  }
  const sansContact = lvs.filter((lv) => lv.contact_id == null);
  if (sansContact.length) {
    return {
      ok: false,
      reason: "Une lettre sélectionnée n'a pas de contact signataire. Renseignez-le d'abord.",
    };
  }
  const contactIds = [...new Set(lvs.map((lv) => lv.contact_id))];
  if (contactIds.length > 1) {
    return {
      ok: false,
      reason: "Les lettres sélectionnées n'ont pas le même contact signataire : ne peuvent pas être signées ensemble.",
    };
  }
  return { ok: true, contactId: contactIds[0] };
}
