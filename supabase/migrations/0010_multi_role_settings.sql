-- @migration:     0010_multi_role_settings
-- @description:   Un utilisateur peut cumuler les rôles chauffeur ET bureau
--                 (gérants qui conduisent). Redéfinit les helpers RLS pour lire
--                 un tableau de rôles. Ajoute une table de réglages (bureau).
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          ALTER TABLE bon.utilisateurs DROP COLUMN roles; DROP TABLE bon.reglages;

-- Tableau de rôles (source de vérité). La colonne `role` historique est conservée
-- pour l'affichage et la rétro-compatibilité des insertions mono-rôle.
ALTER TABLE bon.utilisateurs
  ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}'::text[];

-- Back-fill depuis role (desactive => aucun rôle).
UPDATE bon.utilisateurs
   SET roles = CASE WHEN role = 'desactive' THEN '{}'::text[] ELSE ARRAY[role::text] END
 WHERE cardinality(roles) = 0;

-- Synchronise roles depuis role quand seules les insertions mono-rôle sont faites
-- (compat) ; une insertion qui fournit déjà roles n'est pas écrasée.
CREATE OR REPLACE FUNCTION bon.sync_user_roles() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(NEW.roles) = 0 AND NEW.role IS NOT NULL AND NEW.role <> 'desactive' THEN
    NEW.roles := ARRAY[NEW.role::text];
  END IF;
  IF NEW.role = 'desactive' THEN
    NEW.roles := '{}'::text[];
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_roles ON bon.utilisateurs;
CREATE TRIGGER trg_sync_roles BEFORE INSERT OR UPDATE ON bon.utilisateurs
  FOR EACH ROW EXECUTE FUNCTION bon.sync_user_roles();

-- Helpers RLS : basés sur le tableau de rôles d'un utilisateur actif.
CREATE OR REPLACE FUNCTION bon.me() RETURNS bon.utilisateurs
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT * FROM bon.utilisateurs
   WHERE lower(email) = lower(bon.current_actor())
     AND actif = true AND cardinality(roles) > 0
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION bon.is_bureau() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT 'bureau' = ANY((bon.me()).roles) $$;

CREATE OR REPLACE FUNCTION bon.is_chauffeur() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT 'chauffeur' = ANY((bon.me()).roles) $$;

CREATE OR REPLACE FUNCTION bon.is_member() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT bon.is_bureau() OR bon.is_chauffeur() $$;

-- my_role() : rôle « principal » pour l'affichage (bureau prioritaire).
CREATE OR REPLACE FUNCTION bon.my_role() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN bon.is_bureau() THEN 'bureau'
    WHEN bon.is_chauffeur() THEN 'chauffeur'
    ELSE NULL END
$$;

-- Expose roles dans l'API profil.
-- roles ajouté en DERNIÈRE colonne : CREATE OR REPLACE VIEW ne permet que
-- l'ajout de colonnes en fin (pas d'insertion au milieu).
CREATE OR REPLACE VIEW api.profil WITH (security_invoker = true) AS
  SELECT u.id, u.email, u.role, u.nom, u.actif, u.roles
    FROM bon.utilisateurs u
   WHERE lower(u.email) = lower(bon.current_actor())
     AND u.actif = true AND cardinality(u.roles) > 0;
GRANT SELECT ON api.profil TO authenticated;

-- Réglages applicatifs (clé/valeur), lecture/écriture bureau uniquement.
CREATE TABLE IF NOT EXISTS bon.reglages (
  cle        text PRIMARY KEY,
  valeur     text,
  libelle    text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bon.reglages (cle, valeur, libelle) VALUES
  ('signature_envoi_auto', 'false', 'Envoi en signature : manuel (bouton) uniquement — jamais automatique'),
  ('documenso_cc_contact', 'contact@kerlam.fr', 'Copie des mails finaux Documenso à cette adresse'),
  ('alerte_jours', '60', 'Nombre de jours avant échéance déclenchant une alerte'),
  ('carte_conducteur_retard_jours', '28', 'Retard max de téléchargement de la carte conducteur')
ON CONFLICT (cle) DO NOTHING;

ALTER TABLE bon.reglages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON bon.reglages TO authenticated;
GRANT SELECT ON bon.reglages TO service_role;
CREATE POLICY reglages_select ON bon.reglages FOR SELECT TO authenticated
  USING (bon.is_member());
CREATE POLICY reglages_write ON bon.reglages FOR ALL TO authenticated
  USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());

CREATE OR REPLACE VIEW api.reglages WITH (security_invoker = true) AS
  SELECT cle, valeur, libelle, updated_at FROM bon.reglages;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.reglages TO authenticated;

NOTIFY pgrst, 'reload schema';
