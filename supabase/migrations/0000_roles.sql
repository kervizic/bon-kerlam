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

-- Schéma auth (présent sur l'image supabase/postgres ; créé vide sinon). On NE
-- (re)définit PAS auth.uid()/role()/email() : sur supabase/postgres ces fonctions
-- appartiennent à supabase_auth_admin et les redéfinir volerait leur propriété,
-- faisant échouer la migration interne de GoTrue (« must be owner of function uid »).
-- Les règles RLS de ce projet s'appuient sur bon.current_actor() (cf. 0003), qui
-- lit directement le GUC request.jwt.claims — aucune dépendance à auth.*.
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
