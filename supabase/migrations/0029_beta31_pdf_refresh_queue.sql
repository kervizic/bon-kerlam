-- @migration:     0029_beta31_pdf_refresh_queue
-- @description:   (beta.31) File de RAFRAÎCHISSEMENT du cache PDF. Quand une lettre
--                 NON signée (ou ses tours/lignes/prestations/projets) change, un
--                 trigger marque la lettre « à re-rendre » dans bon.lv_pdf_dirty. Le
--                 worker dé-bounce (~20 s) et re-rend le PDF de cache en arrière-plan,
--                 une lettre à la fois. Les triggers sont SECURITY DEFINER : le rôle
--                 applicatif (authenticated) n'a aucun droit sur la file, c'est la
--                 fonction propriétaire qui écrit. Les lettres SIGNÉES ou supprimées
--                 ne sont jamais mises en file (cache purgé à la signature côté worker).
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0029_down.sql

-- File d'attente : une ligne par lettre à re-rendre, horodatée au dernier changement.
CREATE TABLE IF NOT EXISTS bon.lv_pdf_dirty (
  lv_id    bigint PRIMARY KEY REFERENCES bon.lettres_voiture(id) ON DELETE CASCADE,
  dirty_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lv_pdf_dirty_at_idx ON bon.lv_pdf_dirty (dirty_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON bon.lv_pdf_dirty TO bon_worker;

-- Marque une lettre à re-rendre, SAUF si elle est signée ou supprimée. SECURITY
-- DEFINER : s'exécute avec les droits du propriétaire (postgres) pour écrire dans
-- la file quel que soit le rôle qui a déclenché le changement.
CREATE OR REPLACE FUNCTION bon.mark_lv_pdf_dirty(p_lv_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = bon, pg_temp
AS $$
  INSERT INTO bon.lv_pdf_dirty (lv_id, dirty_at)
  SELECT lv.id, now()
    FROM bon.lettres_voiture lv
   WHERE lv.id = p_lv_id AND lv.deleted_at IS NULL AND lv.statut <> 'signee'
  ON CONFLICT (lv_id) DO UPDATE SET dirty_at = now();
$$;

-- Trigger sur l'en-tête de lettre (UPDATE).
CREATE OR REPLACE FUNCTION bon.trg_lv_pdf_dirty_self()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = bon, pg_temp
AS $$
BEGIN
  PERFORM bon.mark_lv_pdf_dirty(NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger sur une table enfant portant lv_id (tours, lv_prestations, lv_projets).
CREATE OR REPLACE FUNCTION bon.trg_lv_pdf_dirty_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = bon, pg_temp
AS $$
BEGIN
  PERFORM bon.mark_lv_pdf_dirty(COALESCE(NEW.lv_id, OLD.lv_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger sur une ligne de tour (lv_id résolu via le tour).
CREATE OR REPLACE FUNCTION bon.trg_lv_pdf_dirty_tourline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = bon, pg_temp
AS $$
DECLARE
  v_lv bigint;
BEGIN
  SELECT t.lv_id INTO v_lv FROM bon.tours t WHERE t.id = COALESCE(NEW.tour_id, OLD.tour_id);
  IF v_lv IS NOT NULL THEN
    PERFORM bon.mark_lv_pdf_dirty(v_lv);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- En-tête : seulement si la lettre reste non signée et non supprimée (évite de
-- mettre en file au passage à « signée »).
DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.lettres_voiture;
CREATE TRIGGER trg_lv_pdf_dirty
  AFTER UPDATE ON bon.lettres_voiture
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL AND NEW.statut <> 'signee')
  EXECUTE FUNCTION bon.trg_lv_pdf_dirty_self();

DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.tours;
CREATE TRIGGER trg_lv_pdf_dirty
  AFTER INSERT OR UPDATE OR DELETE ON bon.tours
  FOR EACH ROW EXECUTE FUNCTION bon.trg_lv_pdf_dirty_child();

DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.lv_prestations;
CREATE TRIGGER trg_lv_pdf_dirty
  AFTER INSERT OR UPDATE OR DELETE ON bon.lv_prestations
  FOR EACH ROW EXECUTE FUNCTION bon.trg_lv_pdf_dirty_child();

DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.lv_projets;
CREATE TRIGGER trg_lv_pdf_dirty
  AFTER INSERT OR DELETE ON bon.lv_projets
  FOR EACH ROW EXECUTE FUNCTION bon.trg_lv_pdf_dirty_child();

DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.tour_lignes;
CREATE TRIGGER trg_lv_pdf_dirty
  AFTER INSERT OR UPDATE OR DELETE ON bon.tour_lignes
  FOR EACH ROW EXECUTE FUNCTION bon.trg_lv_pdf_dirty_tourline();
