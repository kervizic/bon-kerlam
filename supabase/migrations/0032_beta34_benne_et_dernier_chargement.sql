-- @migration:     0032_beta34_benne_et_dernier_chargement
-- @description:   (beta.34) 1) Unité « benne » : aucune contrainte CHECK/enum sur
--                 bon.tour_lignes.unite ni sur bon.articles.unites (texte libre),
--                 donc rien à élargir côté type ; « benne » est ajoutée au catalogue
--                 d'unités par défaut des articles (additif, idempotent) et à la
--                 liste proposée côté front + libellé PDF. ligne_tonnes() renvoie
--                 NULL pour « benne » (poids non convertible) : poids partiel, aucun
--                 total faussé. 2) Reprise des lignes au choix du lieu de chargement :
--                 RPC dernier_chargement_lignes(site|adresse) qui renvoie les lignes
--                 (article, quantité, unité) du DERNIER tour partant de ce lieu, parmi
--                 les lettres visibles par l'utilisateur (RLS), hors corbeille, lettres
--                 signées incluses en lecture. Index légers pour la recherche.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0032_down.sql

-- 1. « benne » dans le catalogue d'unités par défaut des articles (additif).
--    Aucune réécriture de données : on n'ajoute l'unité qu'aux articles qui ne
--    l'ont pas déjà, en préservant l'ordre existant. Idempotent.
UPDATE bon.articles
   SET unites = unites || ARRAY['benne']::text[]
 WHERE NOT ('benne' = ANY (unites));

-- 2. Index légers pour la reprise « dernier chargement par lieu ».
--    Recherche par site permanent de chargement ...
CREATE INDEX IF NOT EXISTS tours_site_chargement_idx
  ON bon.tours (site_chargement_id)
  WHERE deleted_at IS NULL AND site_chargement_id IS NOT NULL;

--    ... et par adresse de chantier de chargement (normalisée, comme adresses_chantier).
CREATE INDEX IF NOT EXISTS tours_chargement_adresse_idx
  ON bon.tours (lower(btrim(chargement_adresse)))
  WHERE deleted_at IS NULL AND chargement_adresse IS NOT NULL;

-- 3. RPC : lignes du DERNIER tour partant d'un lieu de chargement donné.
--    Le lieu est soit un site permanent (p_site_id), soit une adresse de chantier
--    libre (p_adresse, comparée normalisée). p_exclude_tour_id exclut le tour en
--    cours d'édition (il porte déjà ce lieu). Tri : date de lettre puis création,
--    puis ordre/id du tour. STABLE + SECURITY INVOKER (via le wrapper api) : la RLS
--    de bon.tours / lettres_voiture / tour_lignes s'applique telle quelle. On exclut
--    la corbeille (deleted_at). Les lettres signées restent lisibles (aucun filtre
--    de statut). Ligne vide (ni article ni quantité) écartée.
CREATE OR REPLACE FUNCTION bon.dernier_chargement_lignes(
  p_site_id bigint, p_adresse text, p_exclude_tour_id bigint)
  RETURNS TABLE(article_id bigint, article_nom text, quantite numeric, unite text)
  LANGUAGE sql STABLE AS $$
  WITH cible AS (
    SELECT t.id
      FROM bon.tours t
      JOIN bon.lettres_voiture lv ON lv.id = t.lv_id
     WHERE t.deleted_at IS NULL
       AND lv.deleted_at IS NULL
       AND (p_exclude_tour_id IS NULL OR t.id <> p_exclude_tour_id)
       AND (
         (p_site_id IS NOT NULL AND t.site_chargement_id = p_site_id)
         OR
         (p_adresse IS NOT NULL AND t.chargement_adresse IS NOT NULL
            AND lower(btrim(t.chargement_adresse)) = lower(btrim(p_adresse)))
       )
     ORDER BY lv.date_etablissement DESC NULLS LAST, lv.created_at DESC,
              t.ordre DESC, t.id DESC
     LIMIT 1
  )
  SELECT tl.article_id, a.nom AS article_nom, tl.quantite, tl.unite
    FROM cible c
    JOIN bon.tour_lignes tl ON tl.tour_id = c.id
    LEFT JOIN bon.articles a ON a.id = tl.article_id
   WHERE tl.article_id IS NOT NULL OR tl.quantite IS NOT NULL
   ORDER BY tl.id
$$;

CREATE OR REPLACE FUNCTION api.dernier_chargement_lignes(
  p_site_id bigint, p_adresse text, p_exclude_tour_id bigint)
  RETURNS TABLE(article_id bigint, article_nom text, quantite numeric, unite text)
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT * FROM bon.dernier_chargement_lignes(p_site_id, p_adresse, p_exclude_tour_id)
$$;
GRANT EXECUTE ON FUNCTION api.dernier_chargement_lignes(bigint, text, bigint)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
