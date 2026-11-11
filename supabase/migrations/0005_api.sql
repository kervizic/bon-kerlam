-- @migration:     0005_api
-- @description:   Schéma « api » exposé par PostgREST : vues security_invoker
--                 (RLS appliquée) + fonctions RPC portant les règles métier.
--                 supabase-js se connecte avec db:{schema:"api"}.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP SCHEMA api CASCADE;

CREATE SCHEMA IF NOT EXISTS api;
GRANT USAGE ON SCHEMA api TO anon, authenticated, service_role;

-- Vues 1:1 (security_invoker => la RLS du schéma bon s'applique à l'appelant).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
      'utilisateurs','camions','chauffeurs','clients','contacts','projets',
      'sites','articles','lettres_voiture','tours','tour_lignes','audit_log'])
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE VIEW api.%1$I WITH (security_invoker = true) AS '
      'SELECT * FROM bon.%1$I;', t);
    EXECUTE format('ALTER VIEW api.%1$I OWNER TO postgres;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON api.%1$I TO authenticated;', t);
    EXECUTE format('GRANT SELECT ON api.%1$I TO service_role;', t);
  END LOOP;
END $$;

-- Profil de l'utilisateur connecté (ou vide si non autorisé).
CREATE OR REPLACE VIEW api.profil WITH (security_invoker = true) AS
  SELECT u.id, u.email, u.role, u.nom, u.actif
    FROM bon.utilisateurs u
   WHERE lower(u.email) = lower(bon.current_actor())
     AND u.actif = true AND u.role <> 'desactive';
GRANT SELECT ON api.profil TO authenticated;

-- Fonctions RPC (SECURITY INVOKER : s'appuient sur les fonctions bon.*).
CREATE OR REPLACE FUNCTION api.lv_poids(p_lv_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT bon.lv_poids(p_lv_id) $$;

CREATE OR REPLACE FUNCTION api.prefill(p_chauffeur_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT bon.prefill(p_chauffeur_id) $$;

CREATE OR REPLACE FUNCTION api.sites_pour(p_chauffeur_id bigint, p_client_id bigint)
  RETURNS TABLE (id bigint, nom text, adresse text, source integer, rang integer)
  LANGUAGE sql STABLE AS $$ SELECT * FROM bon.sites_pour(p_chauffeur_id, p_client_id) $$;

CREATE OR REPLACE FUNCTION api.site_doublon(
  p_lat double precision, p_lon double precision,
  p_rayon_m double precision DEFAULT 100.0)
  RETURNS TABLE (id bigint, nom text, distance_m double precision)
  LANGUAGE sql STABLE AS $$ SELECT * FROM bon.site_doublon(p_lat, p_lon, p_rayon_m, NULL) $$;

CREATE OR REPLACE FUNCTION api.lv_undo(p_lv_id bigint) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT bon.lv_undo(p_lv_id) $$;

CREATE OR REPLACE FUNCTION api.set_derniere_unite(
  p_chauffeur_id bigint, p_article_id bigint, p_unite text) RETURNS void
  LANGUAGE sql AS $$ SELECT bon.set_derniere_unite(p_chauffeur_id, p_article_id, p_unite) $$;

GRANT EXECUTE ON FUNCTION
  api.lv_poids(bigint), api.prefill(bigint), api.sites_pour(bigint, bigint),
  api.site_doublon(double precision, double precision, double precision),
  api.lv_undo(bigint), api.set_derniere_unite(bigint, bigint, text)
  TO authenticated, service_role;

-- PostgREST : recharge du cache de schéma.
NOTIFY pgrst, 'reload schema';
