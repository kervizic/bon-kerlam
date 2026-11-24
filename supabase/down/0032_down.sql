-- down 0032_beta34_benne_et_dernier_chargement : retire la RPC de reprise du dernier
-- chargement, ses index, et l'unité « benne » ajoutée au catalogue par défaut des
-- articles. Les lignes déjà saisies en « benne » sont conservées (texte libre).

-- 1. RPC dernier chargement.
DROP FUNCTION IF EXISTS api.dernier_chargement_lignes(bigint, text, bigint);
DROP FUNCTION IF EXISTS bon.dernier_chargement_lignes(bigint, text, bigint);

-- 2. Index de recherche du lieu de chargement.
DROP INDEX IF EXISTS bon.tours_chargement_adresse_idx;
DROP INDEX IF EXISTS bon.tours_site_chargement_idx;

-- 3. Retrait de « benne » du catalogue d'unités des articles (sans toucher aux
--    lignes de tour déjà enregistrées, qui restent en texte libre).
UPDATE bon.articles
   SET unites = array_remove(unites, 'benne')
 WHERE 'benne' = ANY (unites);

NOTIFY pgrst, 'reload schema';
