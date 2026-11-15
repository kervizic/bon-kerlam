-- @migration:     0020_quantite_estimee
-- @description:   (beta.20) Quantité estimée de la journée — mention OBLIGATOIRE
--                 (arrêté du 9/11/1999 art. 5 I a). Deux colonnes facultatives à
--                 la saisie sur bon.lettres_voiture : quantite_estimee (nombre) et
--                 quantite_estimee_unite (t / m3 / big_bag). Imprimée sur le PDF en
--                 une ligne « Quantité estimée de la journée : X unité » UNIQUEMENT
--                 si renseignée. RPC bon.derniere_quantite_estimee(chauffeur, client)
--                 : mémoire de la dernière valeur saisie pour ce couple
--                 chauffeur/client (pré-remplissage, calqué sur bon.prefill).
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          ALTER TABLE bon.lettres_voiture
-- @down:            DROP COLUMN IF EXISTS quantite_estimee,
-- @down:            DROP COLUMN IF EXISTS quantite_estimee_unite;
-- @down:          DROP FUNCTION IF EXISTS bon.derniere_quantite_estimee(bigint, bigint);

-- 1) Colonnes sur la lettre --------------------------------------------------
ALTER TABLE bon.lettres_voiture
  ADD COLUMN IF NOT EXISTS quantite_estimee       numeric(12,3),
  ADD COLUMN IF NOT EXISTS quantite_estimee_unite text;

-- Vue API rafraîchie (nouvelles colonnes exposées au front via SELECT *). Les
-- droits sont au niveau TABLE (cf. 0005_api.sql : GRANT … ON api.lettres_voiture),
-- donc les colonnes neuves sont couvertes sans GRANT colonne.
CREATE OR REPLACE VIEW api.lettres_voiture WITH (security_invoker = true) AS
  SELECT * FROM bon.lettres_voiture;

-- 2) Mémoire de la dernière valeur par chauffeur ET client -------------------
-- Dérivée des lettres existantes (pas de table dédiée) : dernière lettre non
-- supprimée de ce chauffeur pour ce client, dont la quantité est renseignée.
-- Le client de la lettre prime, sinon celui du projet (cohérent avec bon.prefill).
CREATE OR REPLACE FUNCTION bon.derniere_quantite_estimee(
  p_chauffeur_id bigint, p_client_id bigint)
  RETURNS jsonb
  LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
           'quantite', lv.quantite_estimee,
           'unite', lv.quantite_estimee_unite)
    FROM bon.lettres_voiture lv
    LEFT JOIN bon.projets p ON p.id = lv.projet_id
   WHERE lv.chauffeur_id = p_chauffeur_id
     AND COALESCE(lv.client_id, p.client_id) = p_client_id
     AND lv.deleted_at IS NULL
     AND lv.quantite_estimee IS NOT NULL
   ORDER BY lv.date_etablissement DESC, lv.created_at DESC
   LIMIT 1;
$$;

-- Wrapper api.* (SECURITY INVOKER) : le front appelle le schéma `api` (PostgREST).
CREATE OR REPLACE FUNCTION api.derniere_quantite_estimee(
  p_chauffeur_id bigint, p_client_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE AS $$
    SELECT bon.derniere_quantite_estimee(p_chauffeur_id, p_client_id) $$;

GRANT EXECUTE ON FUNCTION bon.derniere_quantite_estimee(bigint, bigint)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.derniere_quantite_estimee(bigint, bigint)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
