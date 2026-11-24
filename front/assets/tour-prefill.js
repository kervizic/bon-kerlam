/* tour-prefill.js — logique pure de la reprise des lignes au choix du lieu de
 * chargement d'un tour (beta.34). Aucune dépendance DOM : testable (cf.
 * tour-prefill.test.mjs).
 *
 * Principe : quand on choisit (ou change) le lieu de chargement d'un tour ET que
 * ce tour n'a encore aucune ligne saisie à la main (lignes vides ou lignes
 * reprises automatiquement et non modifiées depuis), on pré-remplit les lignes
 * avec celles du DERNIER tour partant de ce même lieu. On n'écrase JAMAIS une
 * ligne saisie à la main.
 */

// Une ligne est « vide » si ni article ni quantité renseignés.
export function isLigneVide(l) {
  if (!l) return true;
  const hasArticle = l.article_id != null && String(l.article_id) !== "";
  const hasQte = l.quantite != null && String(l.quantite).trim() !== "";
  return !hasArticle && !hasQte;
}

// Peut-on reprendre (pré-remplir) les lignes de ce tour sans rien écraser ?
// Oui seulement si CHAQUE ligne est soit vide, soit issue d'une reprise
// automatique précédente (_reprise === true) ET non modifiée depuis
// (_userTouched !== true). Une liste vide est reprenable.
export function peutReprendre(lignes) {
  return (lignes || []).every(
    (l) => !l || (!l._userTouched && (isLigneVide(l) || l._reprise === true)),
  );
}

// Normalise les lignes renvoyées par la RPC en patchs de création
// (nature/quantité/unité). Les lignes vides côté source sont écartées.
export function lignesReprises(rows) {
  return (rows || [])
    .filter(
      (r) =>
        r &&
        (r.article_id != null ||
          (r.quantite != null && String(r.quantite).trim() !== "")),
    )
    .map((r) => ({
      article_id: r.article_id != null ? r.article_id : null,
      quantite: r.quantite != null ? r.quantite : null,
      unite: r.unite || "t",
    }));
}

// Libellé d'unité avec pluriel, pour l'affichage dans l'app (même table que le
// worker pdf.unite_label). « 1 benne » / « 2 bennes ».
export function uniteLabel(code, quantite) {
  const q = Number(String(quantite == null ? 1 : quantite).replace(",", "."));
  const plural = Number.isFinite(q) && q > 1;
  const map = {
    t: "t",
    m3: "m³",
    unite: plural ? "unités" : "unité",
    big_bag: plural ? "big bags" : "big bag",
    benne: plural ? "bennes" : "benne",
    jour: plural ? "jours" : "jour",
    heure: plural ? "heures" : "heure",
  };
  return map[code] || code || "";
}
