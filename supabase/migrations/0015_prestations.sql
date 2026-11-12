-- @migration:     0015_prestations
-- @description:   Bloc « Prestations » (à part, avant les tours) : référentiels
--                 bon.materiels + bon.prestations, lignes bon.lv_prestations
--                 rattachées directement à la lettre de voiture, matériel par
--                 défaut du camion, RLS, report automatique de la dernière
--                 prestation du chauffeur, et vues api.*. Additive et idempotente.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP VIEW IF EXISTS api.lv_prestations, api.prestations, api.materiels;
--                 DROP TABLE IF EXISTS bon.lv_prestations, bon.prestations, bon.materiels CASCADE;
--                 ALTER TABLE bon.camions DROP COLUMN IF EXISTS materiel_id;

-- Matériels (parc type : camions, mini-pelle…) -------------------------------
CREATE TABLE IF NOT EXISTS bon.materiels (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  libelle     text NOT NULL,
  actif       boolean NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS materiels_libelle_uidx ON bon.materiels (libelle);

-- Prestations (même esprit que bon.articles) ---------------------------------
CREATE TABLE IF NOT EXISTS bon.prestations (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  libelle             text NOT NULL,           -- imprimé sur la LV
  unite_defaut        text,
  commentaire_interne text,                    -- JAMAIS imprimé sur la LV
  actif               boolean NOT NULL DEFAULT true,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Lignes de prestation d'une lettre de voiture (bloc à part, avant les tours)--
CREATE TABLE IF NOT EXISTS bon.lv_prestations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lv_id         bigint NOT NULL REFERENCES bon.lettres_voiture(id) ON DELETE CASCADE,
  prestation_id bigint REFERENCES bon.prestations(id) ON DELETE SET NULL,
  quantite      numeric(12,3),
  unite         text,
  materiel_id   bigint REFERENCES bon.materiels(id) ON DELETE SET NULL,
  ordre         integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lv_prestations_lv_idx ON bon.lv_prestations (lv_id);

-- Matériel par défaut d'un camion --------------------------------------------
ALTER TABLE bon.camions
  ADD COLUMN IF NOT EXISTS materiel_id bigint REFERENCES bon.materiels(id) ON DELETE SET NULL;

-- Déclencheurs updated_at (même boucle que 0001) -----------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['materiels','prestations','lv_prestations'])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_touch ON bon.%1$I;'
      'CREATE TRIGGER trg_touch BEFORE UPDATE ON bon.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION bon.touch_updated_at();', t);
  END LOOP;
END $$;

-- Seed idempotent : matériels ------------------------------------------------
INSERT INTO bon.materiels (libelle, created_by)
SELECT v.libelle, 'seed'
FROM (VALUES
  ('15 t 6×4 bi-benne grue'),
  ('20 t 8×4 bi-benne'),
  ('20 t 8×4 bi-benne grue'),
  ('20 t 8×4 ampliroll grue'),
  ('Mini-pelle sur chenilles 2–2,8 t')
) AS v(libelle)
WHERE NOT EXISTS (SELECT 1 FROM bon.materiels m WHERE m.libelle = v.libelle);

-- Seed idempotent : prestations ----------------------------------------------
INSERT INTO bon.prestations (libelle, unite_defaut, commentaire_interne, actif, created_by)
SELECT v.libelle, v.unite, NULL, true, 'seed'
FROM (VALUES
  ('Jour de régie avec chauffeur', 'jour'),
  ('Heure supplémentaire jour',    'heure'),
  ('Heure supplémentaire nuit',    'heure'),
  ('Heure supplémentaire week-end','heure'),
  ('Astreinte',                    'unite')
) AS v(libelle, unite)
WHERE NOT EXISTS (SELECT 1 FROM bon.prestations p WHERE p.libelle = v.libelle);

-- Droits de table (RLS filtre ensuite les lignes). ---------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bon.materiels, bon.prestations, bon.lv_prestations
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bon.materiels, bon.prestations, bon.lv_prestations
  TO service_role;

-- Activation RLS (sans FORCE) ------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['materiels','prestations','lv_prestations'])
  LOOP
    EXECUTE format('ALTER TABLE bon.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- Matériels : lecture pour tout membre ; écriture au bureau.
DO $$ BEGIN
  CREATE POLICY materiels_select ON bon.materiels FOR SELECT TO authenticated
    USING (bon.is_member());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY materiels_write ON bon.materiels FOR ALL TO authenticated
    USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Prestations : RLS identique à bon.articles (lecture membre, création membre,
-- modification/suppression bureau).
DO $$ BEGIN
  CREATE POLICY prestations_select ON bon.prestations FOR SELECT TO authenticated
    USING (bon.is_member());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY prestations_insert ON bon.prestations FOR INSERT TO authenticated
    WITH CHECK (bon.is_member());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY prestations_update ON bon.prestations FOR UPDATE TO authenticated
    USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY prestations_delete ON bon.prestations FOR DELETE TO authenticated
    USING (bon.is_bureau());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lignes de prestation : rattachées directement à une LV visible/modifiable
-- (identique à bon.tour_lignes, mais via lv_id). Le chauffeur propriétaire de la
-- lettre peut écrire ses prestations, comme les lignes de chargement.
DO $$ BEGIN
  CREATE POLICY lv_prestations_select ON bon.lv_prestations FOR SELECT TO authenticated
    USING (bon.lv_visible(lv_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY lv_prestations_insert ON bon.lv_prestations FOR INSERT TO authenticated
    WITH CHECK (bon.lv_modifiable(lv_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY lv_prestations_update ON bon.lv_prestations FOR UPDATE TO authenticated
    USING (bon.lv_modifiable(lv_id)) WITH CHECK (bon.lv_modifiable(lv_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY lv_prestations_delete ON bon.lv_prestations FOR DELETE TO authenticated
    USING (bon.lv_modifiable(lv_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Report automatique : première prestation de la dernière LV du chauffeur ------
-- (dernière = date_etablissement puis id décroissants, non supprimée, possédant
-- au moins une ligne de prestation). Première = ordre croissant puis id.
CREATE OR REPLACE FUNCTION bon.derniere_prestation(p_chauffeur_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT jsonb_build_object(
           'prestation_id', lp.prestation_id,
           'unite',         lp.unite,
           'quantite',      lp.quantite,
           'materiel_id',   lp.materiel_id)
    FROM bon.lv_prestations lp
   WHERE lp.lv_id = (
           SELECT lv.id
             FROM bon.lettres_voiture lv
            WHERE lv.chauffeur_id = p_chauffeur_id
              AND lv.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM bon.lv_prestations x WHERE x.lv_id = lv.id)
            ORDER BY lv.date_etablissement DESC, lv.id DESC
            LIMIT 1)
   ORDER BY lp.ordre ASC, lp.id ASC
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION bon.derniere_prestation(bigint) TO authenticated, service_role;

-- Schéma api : vues 1:1 (security_invoker => RLS appliquée à l'appelant) -------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['materiels','prestations','lv_prestations'])
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE VIEW api.%1$I WITH (security_invoker = true) AS '
      'SELECT * FROM bon.%1$I;', t);
    EXECUTE format('ALTER VIEW api.%1$I OWNER TO postgres;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON api.%1$I TO authenticated;', t);
    EXECUTE format('GRANT SELECT ON api.%1$I TO service_role;', t);
  END LOOP;
END $$;

-- api.camions ré-expose la nouvelle colonne materiel_id : une vue « SELECT * »
-- fige la liste de ses colonnes à sa création (0005), on la recrée donc ici
-- (CREATE OR REPLACE conserve propriétaire et droits ; ajout de colonne en fin
-- de liste autorisé).
CREATE OR REPLACE VIEW api.camions WITH (security_invoker = true) AS
  SELECT * FROM bon.camions;

-- Wrapper RPC (SECURITY INVOKER : s'appuie sur la fonction bon.*).
CREATE OR REPLACE FUNCTION api.derniere_prestation(p_chauffeur_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT bon.derniere_prestation(p_chauffeur_id) $$;
GRANT EXECUTE ON FUNCTION api.derniere_prestation(bigint) TO authenticated, service_role;

-- PostgREST : recharge du cache de schéma.
NOTIFY pgrst, 'reload schema';
