-- @migration:     0033_beta35_photos_lignes
-- @description:   (beta.35) Photos « Avant » / « Après » par ligne de marchandise.
--                 Table bon.ligne_photos (métadonnées : date de prise, GPS, chemin
--                 storage) + vue api.ligne_photos ; RLS alignée sur la visibilité
--                 de la lettre (propriétaire chauffeur + bureau ; jamais anon).
--                 Ajout possible même après signature (n'altère pas la lettre ; le
--                 trigger d'immuabilité 0027 n'est pas touché) ; suppression par
--                 l'auteur uniquement et refusée par RLS sur une lettre signée.
--                 Max 4 photos par type et par ligne (trigger). Bucket Storage
--                 privé « photos-lignes » + policies storage (tolérantes : absentes
--                 en test SQL pur). File bon.storage_purge alimentée à chaque
--                 suppression de photo (cascade ligne/tour/lettre comprise) : le
--                 worker supprime les objets storage. Purge des photos des tours
--                 en corbeille > 30 j. Aucun impact PDF (aucun trigger lv_pdf_dirty,
--                 template inchangé). Additive, rejouable.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0033_down.sql

-- 1. Table des photos -----------------------------------------------------------
-- id = UUID généré par le client (identique au nom de fichier) : l'envoi différé
-- (file hors ligne) est ainsi idempotent (un doublon est simplement refusé).
CREATE TABLE IF NOT EXISTS bon.ligne_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ligne_id      bigint NOT NULL REFERENCES bon.tour_lignes(id) ON DELETE CASCADE,
  lv_id         bigint NOT NULL REFERENCES bon.lettres_voiture(id) ON DELETE CASCADE,
  tour_id       bigint NOT NULL REFERENCES bon.tours(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('avant', 'apres')),
  taken_at      timestamptz NOT NULL DEFAULT now(),
  lat           double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng           double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  accuracy_m    real CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  storage_path  text NOT NULL UNIQUE
                CHECK (storage_path ~ '^lv/[0-9]{1,18}/ligne/[0-9]{1,18}/[0-9a-f-]{36}\.jpg$'),
  created_by    text NOT NULL DEFAULT bon.current_actor(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ligne_photos_lv_idx    ON bon.ligne_photos (lv_id);
CREATE INDEX IF NOT EXISTS ligne_photos_ligne_idx ON bon.ligne_photos (ligne_id, type);
CREATE INDEX IF NOT EXISTS ligne_photos_tour_idx  ON bon.ligne_photos (tour_id);

-- 2. File de suppression des objets storage (traitée par le worker) -------------
CREATE TABLE IF NOT EXISTS bon.storage_purge (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket     text NOT NULL,
  path       text NOT NULL,
  queued_at  timestamptz NOT NULL DEFAULT now(),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS storage_purge_queued_idx ON bon.storage_purge (queued_at);
ALTER TABLE bon.storage_purge ENABLE ROW LEVEL SECURITY;  -- aucune policy : invisible aux clients
REVOKE ALL ON bon.storage_purge FROM authenticated, anon;
GRANT SELECT, UPDATE, DELETE ON bon.storage_purge TO bon_worker, service_role;

-- 3. Helpers de chemin storage : lv/<lv_id>/ligne/<ligne_id>/<uuid>[.thumb].jpg --
CREATE OR REPLACE FUNCTION bon.photo_path_lv(p_name text) RETURNS bigint
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name ~ '^lv/[0-9]{1,18}/ligne/[0-9]{1,18}/[0-9a-f-]{36}(\.thumb)?\.jpg$'
    THEN split_part(p_name, '/', 2)::bigint END
$$;

-- Chemin cohérent : la ligne appartient bien à un tour de cette lettre.
CREATE OR REPLACE FUNCTION bon.photo_path_ok(p_name text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT bon.photo_path_lv(p_name) IS NOT NULL AND EXISTS (
    SELECT 1 FROM bon.tour_lignes l JOIN bon.tours t ON t.id = l.tour_id
     WHERE l.id = split_part(p_name, '/', 4)::bigint
       AND t.lv_id = bon.photo_path_lv(p_name))
$$;
GRANT EXECUTE ON FUNCTION bon.photo_path_lv(text), bon.photo_path_ok(text)
  TO authenticated, service_role;

-- 4. Cohérence + plafond (BEFORE INSERT) ----------------------------------------
-- SECURITY DEFINER : le comptage doit voir toutes les photos de la ligne.
CREATE OR REPLACE FUNCTION bon.trg_ligne_photos_check() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM bon.tour_lignes l JOIN bon.tours t ON t.id = l.tour_id
       WHERE l.id = NEW.ligne_id AND t.id = NEW.tour_id AND t.lv_id = NEW.lv_id) THEN
    RAISE EXCEPTION 'Photo incohérente : la ligne % n''appartient pas au tour % de la lettre %.',
      NEW.ligne_id, NEW.tour_id, NEW.lv_id USING ERRCODE = 'check_violation';
  END IF;
  IF split_part(NEW.storage_path, '/', 2) <> NEW.lv_id::text
     OR split_part(NEW.storage_path, '/', 4) <> NEW.ligne_id::text THEN
    RAISE EXCEPTION 'Chemin de photo incohérent.' USING ERRCODE = 'check_violation';
  END IF;
  -- Sérialise les insertions concurrentes sur une même ligne.
  PERFORM pg_advisory_xact_lock(hashtextextended('ligne_photos', NEW.ligne_id));
  SELECT count(*) INTO v_n FROM bon.ligne_photos
   WHERE ligne_id = NEW.ligne_id AND type = NEW.type;
  IF v_n >= 4 THEN
    RAISE EXCEPTION 'Maximum 4 photos « % » par ligne.', NEW.type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ligne_photos_check ON bon.ligne_photos;
CREATE TRIGGER trg_ligne_photos_check BEFORE INSERT ON bon.ligne_photos
  FOR EACH ROW EXECUTE FUNCTION bon.trg_ligne_photos_check();

-- 5. Suppression (directe ou en cascade) => objets storage mis en file -----------
CREATE OR REPLACE FUNCTION bon.trg_ligne_photos_purge() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
BEGIN
  INSERT INTO bon.storage_purge (bucket, path) VALUES
    ('photos-lignes', OLD.storage_path),
    ('photos-lignes', regexp_replace(OLD.storage_path, '\.jpg$', '.thumb.jpg'));
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_ligne_photos_purge ON bon.ligne_photos;
CREATE TRIGGER trg_ligne_photos_purge AFTER DELETE ON bon.ligne_photos
  FOR EACH ROW EXECUTE FUNCTION bon.trg_ligne_photos_purge();

-- 6. Purge des photos des TOURS en corbeille depuis plus de 30 jours ------------
-- (les lettres en corbeille sont purgées par bon.purge_corbeille : cascade FK.)
CREATE OR REPLACE FUNCTION bon.purge_photos_corbeille() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_n int;
BEGIN
  DELETE FROM bon.ligne_photos p
   USING bon.tours t
   WHERE t.id = p.tour_id
     AND t.deleted_at IS NOT NULL
     AND t.deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION bon.purge_photos_corbeille() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bon.purge_photos_corbeille() TO bon_worker, service_role;

-- 7. RLS ------------------------------------------------------------------------
ALTER TABLE bon.ligne_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bon.ligne_photos FROM anon;
GRANT SELECT, INSERT, DELETE ON bon.ligne_photos TO authenticated;
GRANT SELECT, DELETE ON bon.ligne_photos TO service_role, bon_worker;

DROP POLICY IF EXISTS ligne_photos_select ON bon.ligne_photos;
CREATE POLICY ligne_photos_select ON bon.ligne_photos FOR SELECT TO authenticated
  USING (bon.lv_visible(lv_id));

-- Ajout : membre actif, lettre visible (signée comprise), auteur = soi-même.
DROP POLICY IF EXISTS ligne_photos_insert ON bon.ligne_photos;
CREATE POLICY ligne_photos_insert ON bon.ligne_photos FOR INSERT TO authenticated
  WITH CHECK (bon.is_member()
    AND bon.lv_visible(lv_id)
    AND lower(created_by) = lower(bon.current_actor()));

-- Suppression : auteur uniquement, et jamais sur une lettre signée.
DROP POLICY IF EXISTS ligne_photos_delete ON bon.ligne_photos;
CREATE POLICY ligne_photos_delete ON bon.ligne_photos FOR DELETE TO authenticated
  USING (lower(created_by) = lower(bon.current_actor())
    AND bon.lv_modifiable(lv_id));

-- 8. Vue API (security_invoker => RLS de bon.ligne_photos) -----------------------
CREATE OR REPLACE VIEW api.ligne_photos WITH (security_invoker = true) AS
  SELECT * FROM bon.ligne_photos;
ALTER VIEW api.ligne_photos OWNER TO postgres;
REVOKE ALL ON api.ligne_photos FROM anon;
GRANT SELECT, INSERT, DELETE ON api.ligne_photos TO authenticated;
GRANT SELECT ON api.ligne_photos TO service_role;

-- 9. Bucket privé + policies Storage (tolérant : absent en test SQL pur) -------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
        VALUES ('photos-lignes', 'photos-lignes', false)
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Bucket photos-lignes non créé (%) : à créer via l''API Storage.', SQLERRM;
    END;
    BEGIN
      UPDATE storage.buckets
         SET file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg']
       WHERE id = 'photos-lignes';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Limites du bucket photos-lignes non posées (%).', SQLERRM;
    END;
    BEGIN
      DROP POLICY IF EXISTS photos_lignes_select ON storage.objects;
      CREATE POLICY photos_lignes_select ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'photos-lignes' AND bon.lv_visible(bon.photo_path_lv(name)));
      DROP POLICY IF EXISTS photos_lignes_insert ON storage.objects;
      CREATE POLICY photos_lignes_insert ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'photos-lignes'
          AND bon.is_member()
          AND bon.lv_visible(bon.photo_path_lv(name))
          AND bon.photo_path_ok(name));
      -- Pas d'UPDATE ni de DELETE client : les objets sont supprimés par le worker
      -- (service_role) via la file bon.storage_purge.
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Policies storage photos-lignes non posées (%) : à (re)créer au déploiement.', SQLERRM;
    END;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
