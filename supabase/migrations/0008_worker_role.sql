-- @migration:     0008_worker_role
-- @description:   Rôle dédié « bon_worker » aux droits minimaux pour le service
--                 applicatif (lecture métier, clôture de minuit, jetons IA).
--                 BYPASSRLS pour les tâches serveur. Mot de passe/LOGIN posés
--                 côté serveur (deploy), jamais dans le dépôt.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP OWNED BY bon_worker; DROP ROLE bon_worker;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bon_worker') THEN
    CREATE ROLE bon_worker NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA bon, api, svc, meta TO bon_worker;

GRANT SELECT ON ALL TABLES IN SCHEMA bon TO bon_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO bon_worker;
GRANT SELECT ON meta.schema_migrations TO bon_worker;
-- Clôture de minuit : mise à jour du statut des LV.
GRANT UPDATE ON bon.lettres_voiture TO bon_worker;
-- Géocodage du seed : compléter lat/lon des sites.
GRANT UPDATE ON bon.sites TO bon_worker;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bon TO bon_worker;
GRANT EXECUTE ON FUNCTION
  svc.ai_token_scope(text), svc.ai_token_add(text, text, text), svc.ai_token_revoke(bigint)
  TO bon_worker;

-- Les objets créés après cette migration héritent des droits de lecture.
ALTER DEFAULT PRIVILEGES IN SCHEMA bon GRANT SELECT ON TABLES TO bon_worker;
