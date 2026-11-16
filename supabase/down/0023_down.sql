-- Retour arrière de 0023_regroupement_beta22 (testé par supabase/tests).
-- Rétablit l'état post-0022. Idempotent.
-- NB : la fiche vide « Nouveau site » supprimée par 0023 n'est PAS recréée
-- (donnée de test sans contenu) ; pour la prod, le rollback de référence reste
-- la restauration du dump pré-migration.

-- 1) Annulation des fusions créées par la migration (acteur NULL = contexte
--    migration). Rétablit Yterres (site) et les clients Veolia/Syneos.
DO $$
DECLARE v_id bigint;
BEGIN
  FOR v_id IN
    SELECT id FROM bon.fusions
     WHERE par IS NULL AND annulee_at IS NULL
     ORDER BY id DESC
  LOOP
    PERFORM bon.fusion_annuler(v_id);
  END LOOP;
END $$;

-- 2) Suppression des sites insérés par 0023 (32 + Veolia - Noisy).
DELETE FROM bon.sites WHERE created_by = 'migration-0023';

-- 3) Restauration du site Veolia « usine des Terres ».
DELETE FROM bon.aliases
 WHERE cible_type = 'site' AND alias = 'Veolia Noisy-le-Grand (usine des Terres)';
UPDATE bon.sites
   SET nom = 'Veolia Noisy-le-Grand (usine des Terres)', societe_id = NULL
 WHERE nom = 'Veolia - Usine des Terres';

-- 4) Détachement des sites existants de leur société.
UPDATE bon.sites SET societe_id = NULL
 WHERE nom IN ('YPREMA Lagny','YPREMA Émerainville','YPREMA Bonneuil',
               'YPREMA Massy','YPREMA Trappes','YPREMA Gennevilliers','KERLAM Villevaudé');

-- 5) Suppression des sociétés de sites créées par 0023.
DELETE FROM bon.site_societes WHERE created_by = 'migration-0023';

-- 6) Réinitialisation cosmétique des libellés d'adresses posés par 0023.
UPDATE bon.client_adresses SET libelle = 'Principale'
 WHERE libelle IN ('Épinay','Noisy','Gournay','Neuilly');

NOTIFY pgrst, 'reload schema';
