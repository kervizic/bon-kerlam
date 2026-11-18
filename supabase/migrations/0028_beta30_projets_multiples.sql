-- @migration:     0028_beta30_projets_multiples
-- @description:   (beta.30) Projets MULTIPLES par lettre. Table de liaison N-N
--                 bon.lv_projets (lettre <-> projets), projet_id FACULTATIF sur les
--                 tours, et adresse/lat/lon + nom NULLABLE (déjà) avec contrainte
--                 « nom OU adresse » sur bon.projets (projet « adresse seule » permis).
--                 Reprise de l'actuel lettres_voiture.projet_id dans la liaison.
--                 L'index unique « une LV par projet et par jour » devient caduc en
--                 N-N : il est retiré. Les projets restent FACULTATIFS (aucun blocage).
--                 Les lettres SIGNÉES restent figées : la RLS de lv_projets s'appuie
--                 sur bon.lv_modifiable (qui exige statut <> 'signee').
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0028_down.sql

-- 1. Adresse facultative sur les projets + contrainte « nom OU adresse ».
ALTER TABLE bon.projets
  ADD COLUMN IF NOT EXISTS adresse text,
  ADD COLUMN IF NOT EXISTS lat     double precision,
  ADD COLUMN IF NOT EXISTS lon     double precision;

ALTER TABLE bon.projets DROP CONSTRAINT IF EXISTS projets_nom_ou_adresse_chk;
ALTER TABLE bon.projets ADD CONSTRAINT projets_nom_ou_adresse_chk
  CHECK (nom IS NOT NULL OR adresse IS NOT NULL);

-- 2. Projet facultatif rattaché à un tour.
ALTER TABLE bon.tours
  ADD COLUMN IF NOT EXISTS projet_id bigint REFERENCES bon.projets(id) ON DELETE SET NULL;

-- 3. Liaison N-N lettre <-> projets.
CREATE TABLE IF NOT EXISTS bon.lv_projets (
  lv_id      bigint NOT NULL REFERENCES bon.lettres_voiture(id) ON DELETE CASCADE,
  projet_id  bigint NOT NULL REFERENCES bon.projets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lv_id, projet_id)
);
CREATE INDEX IF NOT EXISTS lv_projets_projet_idx ON bon.lv_projets (projet_id);

-- 4. Reprise : chaque lettre portant un projet_id hérite d'un lien (patron 0018).
INSERT INTO bon.lv_projets (lv_id, projet_id)
  SELECT id, projet_id FROM bon.lettres_voiture
   WHERE projet_id IS NOT NULL AND deleted_at IS NULL
  ON CONFLICT DO NOTHING;

-- 5. Index unique « une LV par projet et par jour » caduc en N-N -> retiré.
DROP INDEX IF EXISTS bon.lv_projet_jour_uidx;

-- 6. RLS de la liaison : calquée sur les tours. La modifiabilité passe par
--    bon.lv_modifiable (bureau OU owner, ET statut <> 'signee') -> une lettre signée
--    ne change plus de projets.
ALTER TABLE bon.lv_projets ENABLE ROW LEVEL SECURITY;
CREATE POLICY lv_projets_select ON bon.lv_projets FOR SELECT TO authenticated
  USING (bon.lv_visible(lv_id));
CREATE POLICY lv_projets_insert ON bon.lv_projets FOR INSERT TO authenticated
  WITH CHECK (bon.lv_modifiable(lv_id));
CREATE POLICY lv_projets_delete ON bon.lv_projets FOR DELETE TO authenticated
  USING (bon.lv_modifiable(lv_id));
GRANT SELECT, INSERT, DELETE ON bon.lv_projets TO authenticated;

-- 7. Vues api : recréées (SELECT * figé) pour exposer les nouvelles colonnes + la liaison.
CREATE OR REPLACE VIEW api.projets WITH (security_invoker = true) AS SELECT * FROM bon.projets;
ALTER VIEW api.projets OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.projets TO authenticated;

CREATE OR REPLACE VIEW api.tours WITH (security_invoker = true) AS SELECT * FROM bon.tours;
ALTER VIEW api.tours OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tours TO authenticated;

CREATE OR REPLACE VIEW api.lv_projets WITH (security_invoker = true) AS SELECT * FROM bon.lv_projets;
ALTER VIEW api.lv_projets OWNER TO postgres;
GRANT SELECT, INSERT, DELETE ON api.lv_projets TO authenticated;

NOTIFY pgrst, 'reload schema';
