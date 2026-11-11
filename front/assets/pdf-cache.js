/* pdf-cache.js — cache local des PDF de lettres de voiture pour l'usage hors
 * ligne (g). Logique pure + un petit magasin à backend injectable, pour pouvoir
 * tester sans IndexedDB (le backend réel vit dans app.js, adossé à IndexedDB).
 *
 * Règle métier : on entretient un PDF hors-ligne uniquement pour les lettres
 * NON signées appartenant au chauffeur connecté. Le cache est purgé à la
 * déconnexion (PdfCache.purge()).
 */
"use strict";

const PREFIX = "lv-pdf-";

export function pdfCacheKey(lvId) {
  return PREFIX + lvId;
}

/** Faut-il entretenir un PDF hors-ligne pour cette lettre ? */
export function shouldCachePdf(lv, chauffeurId) {
  if (!lv || lv.id == null) return false;
  if (lv.statut === "signee") return false;
  if (chauffeurId == null) return false;
  return lv.chauffeur_id === chauffeurId;
}

/** « généré le JJ/MM à HH:MM » à partir d'un timestamp (ms). */
export function formatGeneratedAt(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `généré le ${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * backend : { get(key)->val|undefined, put(key,val), delete(key), keys()->array }
 * Les valeurs stockées : { blob, generatedAt, lvId }.
 */
export class PdfCache {
  constructor(backend) {
    this.backend = backend;
  }

  async put(lvId, blob, ts) {
    await this.backend.put(pdfCacheKey(lvId), { blob, generatedAt: ts, lvId });
  }

  async get(lvId) {
    const v = await this.backend.get(pdfCacheKey(lvId));
    return v || null;
  }

  async purge() {
    const keys = (await this.backend.keys()) || [];
    for (const k of keys) {
      if (String(k).startsWith(PREFIX)) await this.backend.delete(k);
    }
  }
}
