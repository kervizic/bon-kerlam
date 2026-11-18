-- down 0028_beta30_projets_multiples : retire la liaison N-N, le projet sur les
-- tours et l'adresse des projets. Restaure l'index unique mono-projet et les vues.

-- Vue de liaison + table.
DROP VIEW IF EXISTS api.lv_projets;
DROP TABLE IF EXISTS bon.lv_projets;

-- projet_id sur les tours (la vue api.tours sera recréée après).
DROP VIEW IF EXISTS api.tours;
ALTER TABLE bon.tours DROP COLUMN IF EXISTS projet_id;
CREATE OR REPLACE VIEW api.tours WITH (security_invoker = true) AS SELECT * FROM bon.tours;
ALTER VIEW api.tours OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tours TO authenticated;

-- Adresse des projets + contrainte (la vue api.projets sera recréée après).
DROP VIEW IF EXISTS api.projets;
ALTER TABLE bon.projets DROP CONSTRAINT IF EXISTS projets_nom_ou_adresse_chk;
ALTER TABLE bon.projets DROP COLUMN IF EXISTS adresse;
ALTER TABLE bon.projets DROP COLUMN IF EXISTS lat;
ALTER TABLE bon.projets DROP COLUMN IF EXISTS lon;
CREATE OR REPLACE VIEW api.projets WITH (security_invoker = true) AS SELECT * FROM bon.projets;
ALTER VIEW api.projets OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.projets TO authenticated;

-- Restaure l'index unique « une LV par projet et par jour ».
CREATE UNIQUE INDEX IF NOT EXISTS lv_projet_jour_uidx
  ON bon.lettres_voiture (projet_id, date_etablissement)
  WHERE deleted_at IS NULL AND projet_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
