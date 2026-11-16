-- @migration:     0021_beta21_corbeille_et_lot
-- @description:   (beta.21) Suppression GROUPÉE d'une sélection de lettres
--                 (bon.lv_supprimer_lot : brouillon -> corbeille, numérotée non
--                 signée -> annulée, signée -> ignorée) + PURGE PHYSIQUE des
--                 brouillons en corbeille depuis plus de 30 jours
--                 (bon.purge_corbeille, idempotente, journalisée par l'audit).
--                 Jamais une lettre numérotée ou signée n'est purgée. Additive.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP FUNCTION IF EXISTS api.lv_supprimer_lot(bigint[], text, text);
--                 DROP FUNCTION IF EXISTS bon.lv_supprimer_lot(bigint[], text, text);
--                 DROP FUNCTION IF EXISTS bon.purge_corbeille();

-- Suppression GROUPÉE d'une sélection ------------------------------------------
-- Applique à CHAQUE id la règle de bon.lv_supprimer (0017) mais SANS lever
-- d'exception sur les lettres signées : elles sont IGNORÉES (comptées à part).
-- Un lv non autorisé (ni bureau, ni propriétaire) est également ignoré en
-- silence (la RLS protège déjà les listes côté client). Renvoie un récapitulatif
-- { corbeille, annulee, ignore_signee, ignore_autre }.
CREATE OR REPLACE FUNCTION bon.lv_supprimer_lot(
    p_lv_ids bigint[], p_categorie text DEFAULT NULL, p_motif text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_actor         text := bon.current_actor();
  v_id            bigint;
  v_lv            bon.lettres_voiture;
  v_corbeille     int := 0;
  v_annulee       int := 0;
  v_ignore_signee int := 0;
  v_ignore_autre  int := 0;
BEGIN
  IF p_lv_ids IS NULL THEN
    RETURN jsonb_build_object('corbeille', 0, 'annulee', 0,
                              'ignore_signee', 0, 'ignore_autre', 0);
  END IF;

  FOREACH v_id IN ARRAY p_lv_ids LOOP
    SELECT * INTO v_lv FROM bon.lettres_voiture WHERE id = v_id;
    IF NOT FOUND THEN
      v_ignore_autre := v_ignore_autre + 1;
      CONTINUE;
    END IF;
    IF NOT (bon.is_bureau() OR lower(v_lv.owner_email) = lower(v_actor)) THEN
      v_ignore_autre := v_ignore_autre + 1;
      CONTINUE;
    END IF;
    IF v_lv.statut = 'signee' THEN
      v_ignore_signee := v_ignore_signee + 1;
      CONTINUE;
    END IF;
    -- Déjà en corbeille / déjà annulée : on ne recompte pas (idempotent).
    IF v_lv.deleted_at IS NOT NULL OR v_lv.statut = 'annulee' THEN
      v_ignore_autre := v_ignore_autre + 1;
      CONTINUE;
    END IF;

    IF v_lv.numero IS NULL THEN
      UPDATE bon.lettres_voiture
         SET deleted_at = now(), deleted_par = v_actor
       WHERE id = v_id;
      v_corbeille := v_corbeille + 1;
    ELSE
      UPDATE bon.lettres_voiture
         SET statut = 'annulee',
             annulation_categorie = p_categorie,
             annulation_motif = p_motif,
             annulee_at = now(),
             annulee_par = v_actor
       WHERE id = v_id;
      v_annulee := v_annulee + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('corbeille', v_corbeille, 'annulee', v_annulee,
                            'ignore_signee', v_ignore_signee, 'ignore_autre', v_ignore_autre);
END $$;
GRANT EXECUTE ON FUNCTION bon.lv_supprimer_lot(bigint[], text, text) TO authenticated, service_role;

-- Purge PHYSIQUE des brouillons en corbeille > 30 jours ------------------------
-- Idempotente (ne touche que ce qui existe encore). Garde-fous DÉTERMINISTES :
-- jamais une lettre numérotée ni signée (numero IS NULL, statut distinct de
-- 'signee') ; uniquement les brouillons réellement mis à la corbeille il y a
-- plus de 30 jours. Le DELETE cascade sur tours / tour_lignes / lv_prestations
-- (FK ON DELETE CASCADE) et est journalisé par le déclencheur d'audit (0003).
CREATE OR REPLACE FUNCTION bon.purge_corbeille()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_ids bigint[];
BEGIN
  WITH victimes AS (
    DELETE FROM bon.lettres_voiture
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '30 days'
       AND numero IS NULL
       AND statut <> 'signee'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM victimes;

  v_ids := COALESCE(v_ids, ARRAY[]::bigint[]);
  IF array_length(v_ids, 1) IS NOT NULL THEN
    RAISE LOG 'bon.purge_corbeille: % brouillon(s) purgé(s): %', array_length(v_ids, 1), v_ids;
  END IF;
  RETURN jsonb_build_object('purged', array_length(v_ids, 1), 'ids', to_jsonb(v_ids));
END $$;
GRANT EXECUTE ON FUNCTION bon.purge_corbeille() TO bon_worker, service_role;

-- Wrapper RPC pour le front (suppression groupée depuis « Mes lettres »).
CREATE OR REPLACE FUNCTION api.lv_supprimer_lot(
    p_lv_ids bigint[], p_categorie text DEFAULT NULL, p_motif text DEFAULT NULL)
  RETURNS jsonb LANGUAGE sql AS $$
  SELECT bon.lv_supprimer_lot(p_lv_ids, p_categorie, p_motif) $$;
GRANT EXECUTE ON FUNCTION api.lv_supprimer_lot(bigint[], text, text) TO authenticated, service_role;

-- PostgREST : recharge du cache de schéma.
NOTIFY pgrst, 'reload schema';
