/* site-label.js — libellé court d'une adresse de site : retire le préfixe du nom
 * de société PUIS tout séparateur restant (– — - · : , /) et les espaces autour.
 * Ex. « Veolia – Noisy » (société « Veolia ») -> « Noisy ». Fonction PURE (testée). */

// Séparateurs à retirer en tête après le préfixe société : espace, tiret demi-
// cadratin (–), cadratin (—), trait d'union (-), point médian (·), : , /.
const LEADING_SEP_RE = /^[\s–—·:,/-]+/;

export function stripSocietePrefix(nom, societeNom) {
  let s = String(nom == null ? "" : nom);
  const soc = String(societeNom == null ? "" : societeNom).trim();
  if (soc && s.toLowerCase().startsWith(soc.toLowerCase())) {
    const rest = s.slice(soc.length);
    // On ne retire le préfixe que s'il est suivi d'un séparateur/espace ou de rien
    // (évite de couper un mot : « Veoliaxx » ne devient pas « xx »).
    if (rest === "" || LEADING_SEP_RE.test(rest)) {
      s = rest.replace(LEADING_SEP_RE, "").trim();
    }
  }
  return s || String(nom == null ? "" : nom);
}
