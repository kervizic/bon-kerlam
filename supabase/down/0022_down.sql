-- Retour arrière de 0022_societe_adresses_fusion (testé par supabase/tests).
-- Rétablit l'état post-0021 : supprime tout ce que 0022 a ajouté, restaure les
-- vues api.* d'origine (SELECT * ...). Idempotent (IF EXISTS partout).

-- 1) Vues API ajoutées / enrichies par 0022 ----------------------------------
DROP VIEW IF EXISTS api.doublons_clients;
DROP VIEW IF EXISTS api.doublons_sites;
DROP VIEW IF EXISTS api.client_adresses;
DROP VIEW IF EXISTS api.site_societes;
DROP VIEW IF EXISTS api.aliases;
DROP VIEW IF EXISTS api.fusions;
DROP VIEW IF EXISTS api.clients;
DROP VIEW IF EXISTS api.sites;
DROP VIEW IF EXISTS api.lettres_voiture;

-- 2) RPC + fonctions métier --------------------------------------------------
DROP FUNCTION IF EXISTS api.fusionner_clients(bigint, bigint[]);
DROP FUNCTION IF EXISTS api.fusionner_site_societes(bigint, bigint[]);
DROP FUNCTION IF EXISTS api.fusionner_sites(bigint, bigint[]);
DROP FUNCTION IF EXISTS api.fusion_annuler(bigint);
DROP FUNCTION IF EXISTS bon.fusionner_clients(bigint, bigint[]);
DROP FUNCTION IF EXISTS bon.fusionner_site_societes(bigint, bigint[]);
DROP FUNCTION IF EXISTS bon.fusionner_sites(bigint, bigint[]);
DROP FUNCTION IF EXISTS bon.fusion_annuler(bigint);

-- 3) Colonnes ajoutées sur des tables existantes -----------------------------
ALTER TABLE bon.lettres_voiture
  DROP COLUMN IF EXISTS client_adresse_id,
  DROP COLUMN IF EXISTS dest_adresse_id;
ALTER TABLE bon.sites
  DROP COLUMN IF EXISTS societe_id,
  DROP COLUMN IF EXISTS merged_into_id,
  DROP COLUMN IF EXISTS merged_at;
ALTER TABLE bon.clients
  DROP COLUMN IF EXISTS merged_into_id,
  DROP COLUMN IF EXISTS merged_at;

-- 4) Tables créées par 0022 --------------------------------------------------
DROP TABLE IF EXISTS bon.fusions;
DROP TABLE IF EXISTS bon.aliases;
DROP TABLE IF EXISTS bon.client_adresses;
DROP TABLE IF EXISTS bon.site_societes;

-- 5) Restauration des vues API d'origine (SELECT * security_invoker) ---------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['clients','sites','lettres_voiture']) LOOP
    EXECUTE format(
      'CREATE OR REPLACE VIEW api.%1$I WITH (security_invoker = true) AS '
      'SELECT * FROM bon.%1$I;', t);
    EXECUTE format('ALTER VIEW api.%1$I OWNER TO postgres;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON api.%1$I TO authenticated;', t);
    EXECUTE format('GRANT SELECT ON api.%1$I TO service_role;', t);
  END LOOP;
END $$;

-- pg_trgm volontairement conservé (inoffensif, peut servir ailleurs).
NOTIFY pgrst, 'reload schema';
