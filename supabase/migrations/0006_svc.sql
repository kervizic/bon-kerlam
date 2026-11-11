-- @migration:     0006_svc
-- @description:   Schéma « svc » réservé au service_role : jetons IA hachés
--                 (portée lecture/écriture, révocables). Jamais exposé au client.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP SCHEMA svc CASCADE;

-- Le hachage utilise sha256() (pg_catalog, aucune extension requise) : robuste
-- quel que soit le schéma de pgcrypto (public / extensions selon l'image).
CREATE SCHEMA IF NOT EXISTS svc;
REVOKE ALL ON SCHEMA svc FROM PUBLIC;
GRANT USAGE ON SCHEMA svc TO service_role;   -- jamais anon / authenticated

CREATE TABLE IF NOT EXISTS svc.ai_tokens (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label      text NOT NULL,
  token_hash text NOT NULL UNIQUE,            -- sha256 hex du jeton en clair
  scope      text NOT NULL DEFAULT 'read' CHECK (scope IN ('read','write')),
  revoked    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
ALTER TABLE svc.ai_tokens ENABLE ROW LEVEL SECURITY;  -- défense en profondeur
GRANT SELECT, INSERT, UPDATE ON svc.ai_tokens TO service_role;

-- Enregistre un jeton (hash du secret en clair) et renvoie son id.
CREATE OR REPLACE FUNCTION svc.ai_token_add(p_label text, p_secret text, p_scope text DEFAULT 'read')
  RETURNS bigint
  LANGUAGE sql SECURITY DEFINER SET search_path = svc, pg_temp AS $$
  INSERT INTO svc.ai_tokens (label, token_hash, scope)
  VALUES (p_label, encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'), p_scope)
  RETURNING id
$$;

-- Vérifie un jeton en clair : renvoie la portée si valide/non révoqué, sinon NULL.
CREATE OR REPLACE FUNCTION svc.ai_token_scope(p_secret text)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = svc, pg_temp AS $$
DECLARE v_scope text;
BEGIN
  UPDATE svc.ai_tokens
     SET last_used_at = now()
   WHERE token_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
     AND revoked = false
  RETURNING scope INTO v_scope;
  RETURN v_scope;
END $$;

CREATE OR REPLACE FUNCTION svc.ai_token_revoke(p_id bigint)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = svc, pg_temp AS $$
  UPDATE svc.ai_tokens SET revoked = true WHERE id = p_id
$$;

GRANT EXECUTE ON FUNCTION
  svc.ai_token_add(text, text, text), svc.ai_token_scope(text), svc.ai_token_revoke(bigint)
  TO service_role;
