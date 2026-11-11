-- @migration:     0012_tour_prefill
-- @description:   Un nouveau tour est pré-rempli : son lieu de CHARGEMENT = lieu
--                 de DÉCHARGEMENT du tour précédent (modifiable). Le premier tour
--                 du bon reste vierge. L'ordre est calculé automatiquement.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP TRIGGER trg_tour_prefill ON bon.tours; DROP FUNCTION bon.trg_tour_prefill();

CREATE OR REPLACE FUNCTION bon.trg_tour_prefill() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_prev bon.tours;
BEGIN
  SELECT * INTO v_prev
    FROM bon.tours
   WHERE lv_id = NEW.lv_id AND deleted_at IS NULL
   ORDER BY ordre DESC, id DESC
   LIMIT 1;

  -- Ordre séquentiel.
  NEW.ordre := COALESCE(v_prev.ordre, 0) + 1;

  -- Pré-remplissage du chargement depuis le déchargement précédent, seulement si
  -- le chargement n'a pas été fourni et qu'un tour précédent existe (pas le 1er).
  IF FOUND AND NEW.site_chargement_id IS NULL THEN
    NEW.site_chargement_id := v_prev.site_dechargement_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tour_prefill ON bon.tours;
CREATE TRIGGER trg_tour_prefill BEFORE INSERT ON bon.tours
  FOR EACH ROW EXECUTE FUNCTION bon.trg_tour_prefill();
