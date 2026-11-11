-- Corrige deux pièges connus de l'image supabase/postgres au premier init :
--  1) le schéma auth doit appartenir à supabase_auth_admin (sinon GoTrue échoue
--     « must be owner of function uid ») ;
--  2) re-pose les mots de passe si roles.sql s'est interrompu.
\set pgpass `echo "$POSTGRES_PASSWORD"`
ALTER USER authenticator          WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin    WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';

ALTER SCHEMA auth OWNER TO supabase_auth_admin;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT 'ALTER TABLE auth.'||tablename||' OWNER TO supabase_auth_admin' s
             FROM pg_tables WHERE schemaname='auth'
  LOOP EXECUTE r.s; END LOOP;
  FOR r IN SELECT 'ALTER FUNCTION auth.'||p.proname||'('
                  ||pg_get_function_identity_arguments(p.oid)
                  ||') OWNER TO supabase_auth_admin' s
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='auth'
  LOOP EXECUTE r.s; END LOOP;
END $$;

-- 3) storage-api : supabase_storage_admin doit pouvoir SET ROLE vers les rôles
--    applicatifs (sinon 403 "permission denied to set role service_role").
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_storage_admin') THEN
    EXECUTE 'GRANT anon, authenticated, service_role TO supabase_storage_admin';
  END IF;
  EXECUTE 'GRANT anon, authenticated, service_role TO authenticator';
END $$;
