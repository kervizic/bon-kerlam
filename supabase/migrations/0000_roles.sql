-- @migration:     0000_roles
-- @description:   Rôles PostgREST (anon / authenticated / service_role / authenticator)
--                 et helpers auth.*. Idempotent. Sur l'image supabase/postgres ces
--                 objets préexistent : la migration ne fait alors que compléter.
-- @role:          superuser
-- @transactional: true
-- @baseline:      true
-- @down:          Ne pas rejouer en prod ; DROP des rôles seulement sur base jetable.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO authenticator;

-- Schéma auth + helpers. Sur supabase/postgres ils existent déjà ; CREATE IF NOT
-- EXISTS / OR REPLACE restent sûrs (on ne change pas le propriétaire ici).
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role'
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'email'
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.email()
  TO anon, authenticated, service_role;
