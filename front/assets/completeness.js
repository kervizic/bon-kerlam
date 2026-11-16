/* completeness.js — contrôle de complétude d'une lettre de voiture (beta.20).
 *
 * UNE fonction unique, pure et testable (réutilisable plus tard par l'envoi en
 * signature) : elle liste CE QUI MANQUE sur une lettre pour pouvoir la signer, avec
 * pour chaque manque un libellé court et un `anchor` (sélecteur CSS du champ à
 * corriger). Les mentions obligatoires retenues : client, destinataire + adresse,
 * date, contact signataire avec e-mail. Les tours (chargement/déchargement/
 * marchandise) sont FACULTATIFS (beta.21.1) : ils ne bloquent jamais la signature.
 *
 * Aucune dépendance DOM : prend l'état (lv, tours) et des annuaires (clients,
 * contacts) et renvoie un tableau d'objets { code, label, anchor }.
 */

function byId(list) {
  const m = new Map();
  for (const r of list || []) m.set(String(r.id), r);
  return m;
}

function hasAddress(client) {
  return !!(client && String(client.adresse || "").trim());
}

/**
 * @param {object} lv            la lettre (client_id, date_etablissement, contact_id,
 *                               dest_identique, destinataire_client_id…)
 * @param {Array}  tours         [{ site_chargement_id, site_dechargement_id, lignes:[{article_id}] }]
 * @param {object} refs          { clients:[], contacts:[] }
 * @returns {Array<{code,label,anchor}>}
 */
export function lvCompleteness(lv, tours, refs) {
  const out = [];
  lv = lv || {};
  tours = Array.isArray(tours) ? tours : [];
  const clients = byId(refs && refs.clients);
  const contacts = byId(refs && refs.contacts);

  // Client (donneur d'ordre).
  const client = lv.client_id != null ? clients.get(String(lv.client_id)) : null;
  if (lv.client_id == null) {
    out.push({ code: "client", label: "Client : à renseigner", anchor: "#f-client" });
  }

  // Date du transport.
  if (!String(lv.date_etablissement || "").trim()) {
    out.push({ code: "date", label: "Date : à renseigner", anchor: "#f-date" });
  }

  // Contact signataire + e-mail obligatoire.
  const contact = lv.contact_id != null ? contacts.get(String(lv.contact_id)) : null;
  if (lv.contact_id == null) {
    out.push({ code: "contact", label: "Contact signataire : à renseigner", anchor: "#f-contact" });
  } else if (!String((contact && contact.email) || "").trim()) {
    out.push({ code: "contact_email", label: "Contact signataire : e-mail manquant", anchor: "#f-contact" });
  }

  // Destinataire + son adresse (imprimée sur la lettre). Par défaut « identique au
  // client » (dest_identique !== false) ; sinon destinataire distinct explicite.
  if (lv.dest_identique === false) {
    // Destinataire distinct explicite.
    if (lv.destinataire_client_id == null) {
      out.push({ code: "destinataire", label: "Destinataire : à renseigner", anchor: "#f-dest-client" });
    } else {
      const dest = clients.get(String(lv.destinataire_client_id));
      if (!hasAddress(dest)) {
        out.push({ code: "destinataire_adresse", label: "Destinataire : adresse manquante", anchor: "#f-dest-client" });
      }
    }
  } else {
    // Destinataire identique au client : l'adresse du client doit exister.
    if (lv.client_id != null && !hasAddress(client)) {
      out.push({ code: "destinataire_adresse", label: "Destinataire : adresse du client manquante", anchor: "#f-client" });
    }
  }

  // Les tours (chargement/déchargement/marchandise) sont FACULTATIFS (beta.21.1) :
  // ils ne doivent JAMAIS bloquer l'envoi en signature. Aucune règle de complétude
  // n'est attachée au nombre de tours ni à leur contenu — `tours` est ignoré ici
  // (gardé dans la signature pour la compatibilité des appelants).
  void tours;

  return out;
}

/** True si l'entité (client/contact/site/projet) a tous ses champs obligatoires. */
export function entityMissingFields(kind, row) {
  const miss = [];
  const v = (k) => String((row && row[k]) || "").trim();
  if (kind === "clients") {
    if (!v("raison_sociale")) miss.push("Nom");
    if (!v("adresse")) miss.push("Adresse");
  } else if (kind === "contacts") {
    if (!v("nom")) miss.push("Nom");
    if (!v("email")) miss.push("E-mail");
  } else if (kind === "sites") {
    if (!v("nom")) miss.push("Nom");
    if (!v("adresse")) miss.push("Adresse");
  } else if (kind === "projets") {
    if (!v("nom")) miss.push("Nom");
  }
  return miss;
}
