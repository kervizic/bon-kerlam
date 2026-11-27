-- @migration:     0034_beta36_documents_chauffeur
-- @description:   (beta.36) « Mes documents » : documents PERSONNELS du chauffeur
--                 (permis, carte conducteur, FCO/FIMO, CACES, autre), recto +
--                 verso facultatif, n° et expiration facultatifs. Visibles
--                 UNIQUEMENT par leur propriétaire et par l'admin (nouveau rôle
--                 « admin » dans bon.utilisateurs.roles, attribuable seulement par
--                 un admin ou le superuser) ; le rôle bureau seul ne les voit PAS ;
--                 jamais anon. Table bon.documents_chauffeur + vue api, RLS, bucket
--                 privé « documents-chauffeurs » + policies storage (tolérantes),
--                 file bon.storage_purge (0033) réutilisée pour les objets
--                 remplacés/supprimés. Liste admin des propriétaires (RPC). Aucun
--                 impact lettres/PDF/mails. Indépendant des tables bureau de 0011
--                 (permis, fco, caces…), inchangées. Additive, rejouable.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0034_down.sql

-- 1. Rôle admin -----------------------------------------------------------------
-- 'admin' est une valeur supplémentaire du tableau bon.utilisateurs.roles (texte
-- libre depuis 0010). Il ne donne AUCUN autre droit que la lecture/suppression des
-- documents personnels des chauffeurs.
CREATE OR REPLACE FUNCTION bon.is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce('admin' = ANY((bon.me()).roles), false) $$;

CREATE OR REPLACE FUNCTION bon.my_user_id() RETURNS bigint
  LANGUAGE sql STABLE AS $$ SELECT (bon.me()).id $$;

GRANT EXECUTE ON FUNCTION bon.is_admin(), bon.my_user_id() TO authenticated, service_role;

-- Garde-fou : le bureau peut écrire bon.utilisateurs (policy util_write) ; il ne
-- doit pas pouvoir s'octroyer (ni retirer, ni supprimer) le rôle admin. Seuls un
-- admin connecté ou une connexion serveur (superuser, service_role) le peuvent.
-- Nom « trg_zz_… » : s'exécute APRÈS trg_sync_roles (ordre alphabétique), donc sur
-- le tableau de rôles final (role = 'desactive' vide roles).
CREATE OR REPLACE FUNCTION bon.trg_utilisateurs_admin_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_before boolean := false;
  v_after  boolean := false;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_before := 'admin' = ANY(OLD.roles); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN v_after := 'admin' = ANY(NEW.roles); END IF;
  IF v_before IS DISTINCT FROM v_after AND NOT bon.is_admin() THEN
    RAISE EXCEPTION 'Seul un administrateur peut attribuer ou retirer le rôle admin.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_zz_admin_guard ON bon.utilisateurs;
CREATE TRIGGER trg_zz_admin_guard BEFORE INSERT OR UPDATE OR DELETE ON bon.utilisateurs
  FOR EACH ROW EXECUTE FUNCTION bon.trg_utilisateurs_admin_guard();

-- 2. Table des documents ----------------------------------------------------------
-- id = UUID généré par le client : l'envoi différé (file hors ligne) est idempotent.
-- Chemins storage : u/<owner_id>/<id>/<uuid fichier>.jpg|pdf (+ .thumb.jpg pour les
-- images). Un fichier remplacé reçoit un NOUVEAU nom ; l'ancien part en purge.
CREATE TABLE IF NOT EXISTS bon.documents_chauffeur (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     bigint NOT NULL DEFAULT bon.my_user_id()
               REFERENCES bon.utilisateurs(id) ON DELETE CASCADE,
  type         text NOT NULL
               CHECK (type IN ('permis', 'carte_conducteur', 'fco_fimo', 'caces', 'autre')),
  libelle      text CHECK (libelle IS NULL OR char_length(libelle) <= 80),
  numero       text CHECK (numero IS NULL OR char_length(numero) <= 60),
  expiration   date,
  recto_path   text NOT NULL,
  verso_path   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_chauffeur_owner_idx ON bon.documents_chauffeur (owner_id);

-- Chemin attendu pour un fichier de ce document.
CREATE OR REPLACE FUNCTION bon.doc_chauffeur_path_ok(p_path text, p_owner bigint, p_doc uuid)
  RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_path IS NOT NULL
     AND p_path ~ ('^u/' || p_owner::text || '/' || p_doc::text || '/[0-9a-f-]{36}\.(jpg|pdf)$')
$$;

-- Propriétaire d'un objet du bucket (u/<owner_id>/…), NULL si chemin invalide.
CREATE OR REPLACE FUNCTION bon.doc_chauffeur_path_owner(p_name text) RETURNS bigint
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name ~ '^u/[0-9]{1,18}/[0-9a-f-]{36}/[0-9a-f-]{36}(\.thumb\.jpg|\.jpg|\.pdf)$'
    THEN split_part(p_name, '/', 2)::bigint END
$$;

-- Objets storage d'un fichier (image + miniature ; PDF seul).
CREATE OR REPLACE FUNCTION bon.doc_chauffeur_objects(p_path text) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_path IS NULL THEN '{}'::text[]
    WHEN p_path ~ '\.jpg$' THEN ARRAY[p_path, regexp_replace(p_path, '\.jpg$', '.thumb.jpg')]
    ELSE ARRAY[p_path] END
$$;

GRANT EXECUTE ON FUNCTION bon.doc_chauffeur_path_ok(text, bigint, uuid),
  bon.doc_chauffeur_path_owner(text), bon.doc_chauffeur_objects(text)
  TO authenticated, service_role;

-- 3. Cohérence (BEFORE INSERT/UPDATE) ------------------------------------------------
CREATE OR REPLACE FUNCTION bon.trg_documents_chauffeur_check() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_n int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Propriétaire ou identifiant non modifiable.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  NEW.libelle := nullif(btrim(NEW.libelle), '');
  NEW.numero := nullif(btrim(NEW.numero), '');
  IF NOT bon.doc_chauffeur_path_ok(NEW.recto_path, NEW.owner_id, NEW.id)
     OR (NEW.verso_path IS NOT NULL AND NOT bon.doc_chauffeur_path_ok(NEW.verso_path, NEW.owner_id, NEW.id))
     OR NEW.verso_path = NEW.recto_path THEN
    RAISE EXCEPTION 'Chemin de document incohérent.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('documents_chauffeur', NEW.owner_id));
    SELECT count(*) INTO v_n FROM bon.documents_chauffeur WHERE owner_id = NEW.owner_id;
    IF v_n >= 40 THEN
      RAISE EXCEPTION 'Maximum 40 documents par personne.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_documents_chauffeur_check ON bon.documents_chauffeur;
CREATE TRIGGER trg_documents_chauffeur_check BEFORE INSERT OR UPDATE ON bon.documents_chauffeur
  FOR EACH ROW EXECUTE FUNCTION bon.trg_documents_chauffeur_check();

-- 4. Fichiers remplacés / documents supprimés (cascade utilisateur comprise) =>
--    objets storage mis en file (worker, file bon.storage_purge de 0033). ------------
CREATE OR REPLACE FUNCTION bon.trg_documents_chauffeur_purge() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_old text[] := '{}'::text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := bon.doc_chauffeur_objects(OLD.recto_path) || bon.doc_chauffeur_objects(OLD.verso_path);
  ELSE
    IF OLD.recto_path IS DISTINCT FROM NEW.recto_path THEN
      v_old := v_old || bon.doc_chauffeur_objects(OLD.recto_path);
    END IF;
    IF OLD.verso_path IS DISTINCT FROM NEW.verso_path THEN
      v_old := v_old || bon.doc_chauffeur_objects(OLD.verso_path);
    END IF;
  END IF;
  INSERT INTO bon.storage_purge (bucket, path)
    SELECT 'documents-chauffeurs', p FROM unnest(v_old) AS p;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_documents_chauffeur_purge ON bon.documents_chauffeur;
CREATE TRIGGER trg_documents_chauffeur_purge AFTER UPDATE OR DELETE ON bon.documents_chauffeur
  FOR EACH ROW EXECUTE FUNCTION bon.trg_documents_chauffeur_purge();

-- 5. RLS : propriétaire + admin. Bureau seul : rien. anon : rien. --------------------
ALTER TABLE bon.documents_chauffeur ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bon.documents_chauffeur FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON bon.documents_chauffeur TO authenticated;
GRANT SELECT, DELETE ON bon.documents_chauffeur TO service_role;

DROP POLICY IF EXISTS documents_chauffeur_select ON bon.documents_chauffeur;
CREATE POLICY documents_chauffeur_select ON bon.documents_chauffeur FOR SELECT TO authenticated
  USING (owner_id = bon.my_user_id() OR bon.is_admin());

DROP POLICY IF EXISTS documents_chauffeur_insert ON bon.documents_chauffeur;
CREATE POLICY documents_chauffeur_insert ON bon.documents_chauffeur FOR INSERT TO authenticated
  WITH CHECK (owner_id = bon.my_user_id());

DROP POLICY IF EXISTS documents_chauffeur_update ON bon.documents_chauffeur;
CREATE POLICY documents_chauffeur_update ON bon.documents_chauffeur FOR UPDATE TO authenticated
  USING (owner_id = bon.my_user_id()) WITH CHECK (owner_id = bon.my_user_id());

DROP POLICY IF EXISTS documents_chauffeur_delete ON bon.documents_chauffeur;
CREATE POLICY documents_chauffeur_delete ON bon.documents_chauffeur FOR DELETE TO authenticated
  USING (owner_id = bon.my_user_id() OR bon.is_admin());

-- 6. API -------------------------------------------------------------------------
CREATE OR REPLACE VIEW api.documents_chauffeur WITH (security_invoker = true) AS
  SELECT * FROM bon.documents_chauffeur;
ALTER VIEW api.documents_chauffeur OWNER TO postgres;
REVOKE ALL ON api.documents_chauffeur FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.documents_chauffeur TO authenticated;
GRANT SELECT ON api.documents_chauffeur TO service_role;

-- Écran admin : propriétaires ayant au moins un document (vide si non admin).
CREATE OR REPLACE FUNCTION api.documents_proprietaires()
  RETURNS TABLE (owner_id bigint, nom text, email text, nb integer, prochaine_expiration date)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT u.id, u.nom, u.email, count(d.id)::int, min(d.expiration)
    FROM bon.documents_chauffeur d JOIN bon.utilisateurs u ON u.id = d.owner_id
   WHERE bon.is_admin()
   GROUP BY u.id, u.nom, u.email
   ORDER BY lower(coalesce(u.nom, u.email))
$$;
REVOKE ALL ON FUNCTION api.documents_proprietaires() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api.documents_proprietaires() TO authenticated;

-- 7. Bucket privé + policies Storage (tolérant : absent en test SQL pur) ------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
        VALUES ('documents-chauffeurs', 'documents-chauffeurs', false)
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Bucket documents-chauffeurs non créé (%) : à créer via l''API Storage.', SQLERRM;
    END;
    BEGIN
      UPDATE storage.buckets
         SET public = false, file_size_limit = 10485760,
             allowed_mime_types = ARRAY['image/jpeg', 'application/pdf']
       WHERE id = 'documents-chauffeurs';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Limites du bucket documents-chauffeurs non posées (%).', SQLERRM;
    END;
    BEGIN
      DROP POLICY IF EXISTS documents_chauffeurs_select ON storage.objects;
      CREATE POLICY documents_chauffeurs_select ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'documents-chauffeurs'
          AND (bon.doc_chauffeur_path_owner(name) = bon.my_user_id() OR bon.is_admin()));
      DROP POLICY IF EXISTS documents_chauffeurs_insert ON storage.objects;
      CREATE POLICY documents_chauffeurs_insert ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'documents-chauffeurs'
          AND bon.doc_chauffeur_path_owner(name) = bon.my_user_id());
      -- Pas d'UPDATE ni de DELETE client : suppression par le worker (service_role)
      -- via la file bon.storage_purge.
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Policies storage documents-chauffeurs non posées (%) : à (re)créer au déploiement.', SQLERRM;
    END;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
