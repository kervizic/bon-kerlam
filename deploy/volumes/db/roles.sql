-- Pose les mots de passe des rôles techniques depuis l'environnement (fresh init).
-- Monté dans /docker-entrypoint-initdb.d/init-scripts/ ; ne s'exécute qu'au
-- premier démarrage (volume vierge). Aucun secret en dur.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator            WITH PASSWORD :'pgpass';
ALTER USER pgbouncer                WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin      WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin   WITH PASSWORD :'pgpass';

-- Rôle applicatif dédié (créé par la migration 0008) : LOGIN + mot de passe.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bon_worker') THEN
    EXECUTE 'ALTER ROLE bon_worker LOGIN';
  END IF;
END $$;
\set wpass `echo "${WORKER_DB_PASSWORD:-$POSTGRES_PASSWORD}"`
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bon_worker') THEN
    EXECUTE format('ALTER ROLE bon_worker PASSWORD %L', :'wpass');
  END IF;
END $$;
