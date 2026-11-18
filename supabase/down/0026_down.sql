-- down 0026_beta28_tour_adresses_chantier : retire les adresses de chantier portées
-- par le tour, restaure le trigger de pré-remplissage de 0012 et la vue api.tours.

-- 1. RPC des adresses de chantier.
DROP FUNCTION IF EXISTS api.adresses_chantier(bigint);
DROP FUNCTION IF EXISTS bon.adresses_chantier(bigint);

-- 2. Restaure le trigger de pré-remplissage dans sa version 0012 (chargement = site
--    de déchargement précédent uniquement).
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

  NEW.ordre := COALESCE(v_prev.ordre, 0) + 1;

  IF FOUND AND NEW.site_chargement_id IS NULL THEN
    NEW.site_chargement_id := v_prev.site_dechargement_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tour_prefill ON bon.tours;
CREATE TRIGGER trg_tour_prefill BEFORE INSERT ON bon.tours
  FOR EACH ROW EXECUTE FUNCTION bon.trg_tour_prefill();

-- 3. Retire les colonnes (la vue api.tours en dépend : on la recrée après).
DROP VIEW IF EXISTS api.tours;
ALTER TABLE bon.tours
  DROP COLUMN IF EXISTS chargement_adresse,
  DROP COLUMN IF EXISTS chargement_lat,
  DROP COLUMN IF EXISTS chargement_lon,
  DROP COLUMN IF EXISTS dechargement_adresse,
  DROP COLUMN IF EXISTS dechargement_lat,
  DROP COLUMN IF EXISTS dechargement_lon;

CREATE OR REPLACE VIEW api.tours WITH (security_invoker = true) AS
  SELECT * FROM bon.tours;
ALTER VIEW api.tours OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tours TO authenticated;

NOTIFY pgrst, 'reload schema';
