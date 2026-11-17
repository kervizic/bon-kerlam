/* signature-group.js — groupage des lettres pour la signature (f).
 * Fonctions PURES, testées (signature-group.test.mjs).
 *
 * beta.23.2 : on ne bloque plus quand la sélection contient des signataires
 * différents. On REGROUPE les lettres PAR SIGNATAIRE ; le front propose :
 *   - « en présentiel » : UN seul signataire à la fois (signature sur ce tél.) ;
 *   - « par mail » : un LOT par signataire (plusieurs possibles).
 * Une lettre sans contact signataire, ou dont le contact n'a pas d'e-mail, est
 * signalée et ne part pas.
 */
"use strict";

function hasEmail(email) {
  return typeof email === "string" && email.includes("@");
}

/**
 * Regroupe les lettres par contact signataire.
 * @param {Array<{id:number, numero?:string, contact_id:number|null}>} lvs
 * @param {Map<number,{nom?:string,email?:string}>|Object} contactsById
 * @returns {{groups:Array<{contactId:number,nom:string,email:string|null,hasEmail:boolean,lvIds:number[],numeros:string[],count:number}>, sansContact:Array}}
 */
export function groupBySignataire(lvs, contactsById) {
  const get = (id) => (contactsById instanceof Map ? contactsById.get(id) : (contactsById || {})[id]) || {};
  const list = lvs || [];
  const sansContact = list.filter((lv) => lv.contact_id == null);
  const byId = new Map();
  for (const lv of list) {
    if (lv.contact_id == null) continue;
    const key = lv.contact_id;
    if (!byId.has(key)) {
      const c = get(key);
      byId.set(key, {
        contactId: key,
        nom: c.nom || "Contact",
        email: c.email || null,
        hasEmail: hasEmail(c.email),
        lvIds: [],
        numeros: [],
        count: 0,
      });
    }
    const g = byId.get(key);
    g.lvIds.push(lv.id);
    g.numeros.push(lv.numero || `#${lv.id}`);
    g.count += 1;
  }
  return { groups: [...byId.values()], sansContact };
}

/**
 * Lots à envoyer selon le mode et les signataires cochés.
 * @param {Array} groups  sortie de groupBySignataire().groups
 * @param {"sur_place"|"par_mail"} mode
 * @param {number[]} checkedContactIds
 * @returns {{ok:boolean, reason?:string, batches?:Array<{contactId:number,email:string|null,lvIds:number[]}>}}
 */
export function signatureBatches(groups, mode, checkedContactIds) {
  const checked = new Set(checkedContactIds || []);
  const sel = (groups || []).filter((g) => checked.has(g.contactId));
  if (!sel.length) {
    return { ok: false, reason: "Choisissez au moins un signataire." };
  }
  // Un contact sans e-mail ne peut pas recevoir d'enveloppe (sur place comme par mail).
  const sansEmail = sel.filter((g) => !g.hasEmail);
  if (sansEmail.length) {
    return {
      ok: false,
      reason: `Signataire sans e-mail : ${sansEmail.map((g) => g.nom).join(", ")}. Renseignez-le d'abord.`,
    };
  }
  if (mode === "sur_place" && sel.length > 1) {
    return { ok: false, reason: "En présentiel, un seul signataire à la fois." };
  }
  return {
    ok: true,
    batches: sel.map((g) => ({ contactId: g.contactId, email: g.email, lvIds: g.lvIds.slice() })),
  };
}
