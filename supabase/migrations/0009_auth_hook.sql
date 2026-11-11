-- @migration:     0009_auth_hook
-- @description:   Hook GoTrue « before user created » : refuse la création d'un
--                 compte dont l'e-mail n'est pas dans la liste blanche active.
--                 Optionnel (activé par GOTRUE_HOOK_BEFORE_USER_CREATED_*). La RLS
--                 reste le garde-fou dur : un compte créé hors liste ne voit RIEN.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP FUNCTION bon.gotrue_before_user_created(jsonb);

CREATE OR REPLACE FUNCTION bon.gotrue_before_user_created(event jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = bon, pg_temp
AS $$
DECLARE
  v_email text;
  v_ok    boolean;
BEGIN
  -- L'e-mail peut arriver sous plusieurs formes selon la version de GoTrue.
  v_email := lower(coalesce(
    event #>> '{claims,email}',
    event #>> '{user,email}',
    event #>> '{user_metadata,email}',
    event ->> 'email'));

  IF v_email IS NULL THEN
    RETURN event;  -- rien à vérifier : on laisse passer (RLS gère ensuite)
  END IF;

  SELECT true INTO v_ok
    FROM bon.utilisateurs
   WHERE lower(email) = v_email
     AND actif = true AND role <> 'desactive'
   LIMIT 1;

  IF v_ok IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Accès non autorisé, contactez le bureau.'));
  END IF;

  RETURN event;  -- autorisé
END $$;

-- GoTrue exécute les hooks via le rôle supabase_auth_admin.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA bon TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION bon.gotrue_before_user_created(jsonb) TO supabase_auth_admin;
  END IF;
END $$;
