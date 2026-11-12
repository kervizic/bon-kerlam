-- @migration:     0017_heures_et_suppression
-- @description:   Heures en créneaux (jsonb) remplaçant le texte libre heures_regie
--                 (ancien texte migré au mieux, sinon conservé en lecture) +
--                 suppression des lettres NON signées : brouillon sans numéro ->
--                 corbeille 30 j restaurable ; lettre numérotée non signée ->
--                 statut « annulée » + motif (numéro conservé) ; lettre signée ->
--                 jamais supprimable. Journal via l'audit générique (0003).
--                 Additive et idempotente.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          ALTER TABLE bon.lettres_voiture
--                   DROP COLUMN IF EXISTS heures,
--                   DROP COLUMN IF EXISTS annulation_motif,
--                   DROP COLUMN IF EXISTS annulation_categorie,
--                   DROP COLUMN IF EXISTS annulee_at,
--                   DROP COLUMN IF EXISTS annulee_par,
--                   DROP COLUMN IF EXISTS deleted_par;
--                 DROP FUNCTION IF EXISTS api.dernieres_heures(bigint);
--                 DROP FUNCTION IF EXISTS api.lv_supprimer(bigint, text, text);
--                 DROP FUNCTION IF EXISTS api.lv_restaurer(bigint);
--                 DROP FUNCTION IF EXISTS bon.dernieres_heures(bigint);
--                 DROP FUNCTION IF EXISTS bon.lv_supprimer(bigint, text, text);
--                 DROP FUNCTION IF EXISTS bon.lv_restaurer(bigint);
--                 DROP VIEW IF EXISTS api.lv_corbeille;

-- Colonnes additives -----------------------------------------------------------
ALTER TABLE bon.lettres_voiture
  ADD COLUMN IF NOT EXISTS heures                jsonb,   -- [{"debut":"HH:MM","fin":"HH:MM"}, …]
  ADD COLUMN IF NOT EXISTS annulation_motif      text,
  ADD COLUMN IF NOT EXISTS annulation_categorie  text,    -- 'doublon' | 'erreur' | 'autre'
  ADD COLUMN IF NOT EXISTS annulee_at            timestamptz,
  ADD COLUMN IF NOT EXISTS annulee_par           text,
  ADD COLUMN IF NOT EXISTS deleted_par           text;    -- qui a mis à la corbeille

-- Migration « au mieux » de l'ancien texte heures_regie vers un créneau unique.
-- Formats reconnus : « 7h30 - 16h00 », « 7:30-16:00 », « 8h-17h » (séparateur
-- tiret, demi-cadratin ou cadratin). Non reconnu => heures reste NULL (le texte
-- heures_regie demeure lisible). Idempotent (ne touche que heures IS NULL).
WITH parsed AS (
  SELECT id,
         regexp_match(heures_regie,
           '(\d{1,2})[h:](\d{0,2})\s*[-–—]\s*(\d{1,2})[h:](\d{0,2})') AS m
    FROM bon.lettres_voiture
   WHERE heures_regie IS NOT NULL AND btrim(heures_regie) <> '' AND heures IS NULL
)
UPDATE bon.lettres_voiture lv
   SET heures = jsonb_build_array(jsonb_build_object(
         'debut', lpad(p.m[1], 2, '0') || ':' || lpad(COALESCE(NULLIF(p.m[2], ''), '00'), 2, '0'),
         'fin',   lpad(p.m[3], 2, '0') || ':' || lpad(COALESCE(NULLIF(p.m[4], ''), '00'), 2, '0')))
  FROM parsed p
 WHERE lv.id = p.id AND p.m IS NOT NULL;

-- Mémoire des créneaux : créneaux de la dernière lettre du chauffeur qui en a ---
-- (dernière = date_etablissement puis id décroissants, non supprimée, heures
-- non vides). Repris à la création d'une nouvelle lettre côté front.
CREATE OR REPLACE FUNCTION bon.dernieres_heures(p_chauffeur_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT lv.heures
    FROM bon.lettres_voiture lv
   WHERE lv.chauffeur_id = p_chauffeur_id
     AND lv.deleted_at IS NULL
     AND lv.heures IS NOT NULL
     AND jsonb_array_length(lv.heures) > 0
   ORDER BY lv.date_etablissement DESC, lv.id DESC
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION bon.dernieres_heures(bigint) TO authenticated, service_role;

-- Suppression / annulation d'une lettre NON signée ----------------------------
-- Règles : lettre signée => jamais ; brouillon sans numéro => corbeille (douce,
-- restaurable 30 j) ; lettre numérotée => statut « annulée » + motif, numéro
-- conservé. Chauffeur : ses propres lettres ; bureau : toutes. Le journal
-- (qui / quand) est tenu par le déclencheur d'audit générique (0003).
CREATE OR REPLACE FUNCTION bon.lv_supprimer(
    p_lv_id bigint, p_categorie text DEFAULT NULL, p_motif text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_actor  text := bon.current_actor();
  v_lv     bon.lettres_voiture;
BEGIN
  SELECT * INTO v_lv FROM bon.lettres_voiture WHERE id = p_lv_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lettre introuvable: %', p_lv_id;
  END IF;
  IF NOT (bon.is_bureau() OR lower(v_lv.owner_email) = lower(v_actor)) THEN
    RAISE EXCEPTION 'Suppression non autorisée';
  END IF;
  IF v_lv.statut = 'signee' THEN
    RAISE EXCEPTION 'Lettre signée : suppression impossible';
  END IF;

  IF v_lv.numero IS NULL THEN
    UPDATE bon.lettres_voiture
       SET deleted_at = now(), deleted_par = v_actor
     WHERE id = p_lv_id;
    RETURN jsonb_build_object('mode', 'corbeille', 'lv_id', p_lv_id);
  END IF;

  UPDATE bon.lettres_voiture
     SET statut = 'annulee',
         annulation_categorie = p_categorie,
         annulation_motif = p_motif,
         annulee_at = now(),
         annulee_par = v_actor
   WHERE id = p_lv_id;
  RETURN jsonb_build_object('mode', 'annulee', 'lv_id', p_lv_id, 'numero', v_lv.numero);
END $$;
GRANT EXECUTE ON FUNCTION bon.lv_supprimer(bigint, text, text) TO authenticated, service_role;

-- Restauration d'un brouillon mis à la corbeille (dans les 30 jours) ----------
CREATE OR REPLACE FUNCTION bon.lv_restaurer(p_lv_id bigint) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_actor text := bon.current_actor();
  v_lv    bon.lettres_voiture;
BEGIN
  SELECT * INTO v_lv FROM bon.lettres_voiture WHERE id = p_lv_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lettre introuvable: %', p_lv_id;
  END IF;
  IF NOT (bon.is_bureau() OR lower(v_lv.owner_email) = lower(v_actor)) THEN
    RAISE EXCEPTION 'Restauration non autorisée';
  END IF;
  IF v_lv.deleted_at IS NULL THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'pas à la corbeille');
  END IF;
  IF v_lv.deleted_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'Corbeille expirée (plus de 30 jours) : restauration impossible';
  END IF;
  UPDATE bon.lettres_voiture
     SET deleted_at = NULL, deleted_par = NULL
   WHERE id = p_lv_id;
  RETURN jsonb_build_object('restored', true, 'lv_id', p_lv_id);
END $$;
GRANT EXECUTE ON FUNCTION bon.lv_restaurer(bigint) TO authenticated, service_role;

-- api.lettres_voiture : « SELECT * » fige ses colonnes à la création (0005). On
-- recrée la vue pour exposer les nouvelles colonnes (CREATE OR REPLACE conserve
-- propriétaire et droits ; ajout de colonnes en fin de liste autorisé).
CREATE OR REPLACE VIEW api.lettres_voiture WITH (security_invoker = true) AS
  SELECT * FROM bon.lettres_voiture;

-- Corbeille : lettres mises au rebut dans les 30 derniers jours (RLS appliquée).
CREATE OR REPLACE VIEW api.lv_corbeille WITH (security_invoker = true) AS
  SELECT * FROM bon.lettres_voiture
   WHERE deleted_at IS NOT NULL AND deleted_at > now() - interval '30 days';
ALTER VIEW api.lv_corbeille OWNER TO postgres;
GRANT SELECT ON api.lv_corbeille TO authenticated;

-- Wrappers RPC (SECURITY INVOKER : s'appuient sur les fonctions bon.*).
CREATE OR REPLACE FUNCTION api.dernieres_heures(p_chauffeur_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT bon.dernieres_heures(p_chauffeur_id) $$;

CREATE OR REPLACE FUNCTION api.lv_supprimer(p_lv_id bigint, p_categorie text DEFAULT NULL, p_motif text DEFAULT NULL)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT bon.lv_supprimer(p_lv_id, p_categorie, p_motif) $$;

CREATE OR REPLACE FUNCTION api.lv_restaurer(p_lv_id bigint) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT bon.lv_restaurer(p_lv_id) $$;

GRANT EXECUTE ON FUNCTION
  api.dernieres_heures(bigint),
  api.lv_supprimer(bigint, text, text),
  api.lv_restaurer(bigint)
  TO authenticated, service_role;

-- PostgREST : recharge du cache de schéma.
NOTIFY pgrst, 'reload schema';
