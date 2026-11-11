-- @migration:     0001_schema_bon
-- @description:   Schéma métier « bon » : référentiels, lettres de voiture, tours,
--                 lignes, compteur de numérotation, mémoire de dernière unité.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP SCHEMA bon CASCADE;

CREATE SCHEMA IF NOT EXISTS bon;
GRANT USAGE ON SCHEMA bon TO authenticated, service_role;

-- Types énumérés -------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE bon.role_utilisateur AS ENUM ('chauffeur', 'bureau', 'desactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bon.portee_site AS ENUM ('commun', 'chantier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bon.statut_site AS ENUM ('actif', 'termine');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bon.statut_lv AS ENUM
    ('preparee', 'en_cours', 'cloturee', 'a_signer', 'envoyee', 'signee', 'facturee', 'annulee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bon.app_nav AS ENUM ('google_maps', 'waze', 'apple_plans');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bon.theme AS ENUM ('auto', 'clair', 'sombre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Liste blanche des utilisateurs (connexion Google) --------------------------
CREATE TABLE IF NOT EXISTS bon.utilisateurs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  role        bon.role_utilisateur NOT NULL DEFAULT 'desactive',
  nom         text,
  auth_uid    uuid,                 -- lien vers auth.users.id (rempli au 1er login)
  actif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS utilisateurs_email_uidx
  ON bon.utilisateurs (lower(email));

-- Camions --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.camions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  immatriculation text NOT NULL UNIQUE,
  type            text,
  ptac_kg         integer,
  poids_vide_kg   integer,
  -- charge utile calculée (jamais négative)
  charge_utile_kg integer GENERATED ALWAYS AS (GREATEST(COALESCE(ptac_kg,0) - COALESCE(poids_vide_kg,0), 0)) STORED,
  volume_benne_m3 numeric(6,2),
  ct_echeance     date,
  chrono_echeance date,
  actif           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Chauffeurs -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.chauffeurs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom            text NOT NULL,
  tel            text,
  email          text,                 -- e-mail Google (liste blanche)
  camion_id      bigint REFERENCES bon.camions(id) ON DELETE SET NULL,
  fco_echeance   date,
  carte_echeance date,
  nav_app        bon.app_nav NOT NULL DEFAULT 'google_maps',
  theme          bon.theme   NOT NULL DEFAULT 'auto',
  actif          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chauffeurs_email_idx ON bon.chauffeurs (lower(email));

-- Clients & contacts ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.clients (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raison_sociale text NOT NULL,
  adresse       text,
  siren         text,
  actif         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bon.contacts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id   bigint NOT NULL REFERENCES bon.clients(id) ON DELETE CASCADE,
  nom         text NOT NULL,
  tel         text,
  email       text NOT NULL,           -- obligatoire
  fonction    text,
  signataire  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Projets --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.projets (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id         bigint NOT NULL REFERENCES bon.clients(id) ON DELETE CASCADE,
  nom               text,
  ref_contrat       text,
  ref_ordre_mission text,
  ligne_regie       text,
  tarif             numeric(10,2),
  contact_id        bigint REFERENCES bon.contacts(id) ON DELETE SET NULL,
  date_debut        date,
  date_fin          date,
  statut            text NOT NULL DEFAULT 'actif',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Sites ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.sites (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom           text NOT NULL,
  adresse       text,
  lat           double precision,
  lon           double precision,
  type          text,                    -- libre (transit, recyclage, point de vente…)
  portee        bon.portee_site NOT NULL DEFAULT 'commun',
  client_id     bigint REFERENCES bon.clients(id) ON DELETE CASCADE,  -- requis si chantier
  statut        bon.statut_site NOT NULL DEFAULT 'actif',
  derniere_utilisation timestamptz,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- un chantier appartient à un client ; un site commun n'en a pas
  CONSTRAINT sites_portee_client_chk CHECK (
    (portee = 'chantier' AND client_id IS NOT NULL) OR
    (portee = 'commun'   AND client_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS sites_portee_idx ON bon.sites (portee, statut);
CREATE INDEX IF NOT EXISTS sites_client_idx ON bon.sites (client_id);

-- Articles -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.articles (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom                text NOT NULL,            -- imprimé sur la LV
  commentaire_interne text,                    -- JAMAIS imprimé sur la LV
  unites             text[] NOT NULL DEFAULT ARRAY['t','m3','unite']::text[],
  densite_t_m3       numeric(8,4),
  poids_unitaire_t   numeric(8,4),
  actif              boolean NOT NULL DEFAULT true,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Compteur de numérotation (continu, sans trou) ------------------------------
CREATE TABLE IF NOT EXISTS bon.lv_counter (
  id         integer PRIMARY KEY DEFAULT 1,
  next_value integer NOT NULL DEFAULT 3000,
  CONSTRAINT lv_counter_singleton CHECK (id = 1)
);
INSERT INTO bon.lv_counter (id, next_value) VALUES (1, 3000)
  ON CONFLICT (id) DO NOTHING;

-- Lettres de voiture ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.lettres_voiture (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero              text UNIQUE,              -- NULL tant qu'aucun tour (KER-#####)
  date_etablissement  date NOT NULL DEFAULT CURRENT_DATE,
  date_prise_en_charge date,
  expediteur          text,
  destinataire        text,
  dest_identique      boolean NOT NULL DEFAULT true,  -- coché d'office
  camion_id           bigint REFERENCES bon.camions(id) ON DELETE SET NULL,
  chauffeur_id        bigint REFERENCES bon.chauffeurs(id) ON DELETE SET NULL,
  projet_id           bigint REFERENCES bon.projets(id) ON DELETE SET NULL,
  contact_id          bigint REFERENCES bon.contacts(id) ON DELETE SET NULL,
  heures_regie        text,
  statut              bon.statut_lv NOT NULL DEFAULT 'en_cours',
  preparee            boolean NOT NULL DEFAULT false,  -- préparée par le bureau (Planning)
  owner_email         text,                    -- chauffeur propriétaire (RLS)
  deleted_at          timestamptz,             -- suppression douce (corbeille 30 j)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lv_owner_idx  ON bon.lettres_voiture (lower(owner_email));
CREATE INDEX IF NOT EXISTS lv_date_idx   ON bon.lettres_voiture (date_etablissement);
CREATE INDEX IF NOT EXISTS lv_statut_idx ON bon.lettres_voiture (statut);
-- Une LV par projet et par jour (parmi les non supprimées)
CREATE UNIQUE INDEX IF NOT EXISTS lv_projet_jour_uidx
  ON bon.lettres_voiture (projet_id, date_etablissement)
  WHERE deleted_at IS NULL AND projet_id IS NOT NULL;

-- Tours ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.tours (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lv_id                 bigint NOT NULL REFERENCES bon.lettres_voiture(id) ON DELETE CASCADE,
  ordre                 integer NOT NULL DEFAULT 1,
  heure_depart          timestamptz,
  gps_lat               double precision,       -- au journal, pas imprimé
  gps_lon               double precision,
  site_chargement_id    bigint REFERENCES bon.sites(id) ON DELETE SET NULL,
  site_dechargement_id  bigint REFERENCES bon.sites(id) ON DELETE SET NULL,
  expediteur            text,
  destinataire          text,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tours_lv_idx ON bon.tours (lv_id);

-- Lignes d'article d'un tour -------------------------------------------------
CREATE TABLE IF NOT EXISTS bon.tour_lignes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tour_id     bigint NOT NULL REFERENCES bon.tours(id) ON DELETE CASCADE,
  article_id  bigint REFERENCES bon.articles(id) ON DELETE SET NULL,
  quantite    numeric(12,3),
  unite       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tour_lignes_tour_idx ON bon.tour_lignes (tour_id);

-- Mémoire de la dernière unité par chauffeur et par article ------------------
CREATE TABLE IF NOT EXISTS bon.derniere_unite (
  chauffeur_id bigint NOT NULL REFERENCES bon.chauffeurs(id) ON DELETE CASCADE,
  article_id   bigint NOT NULL REFERENCES bon.articles(id) ON DELETE CASCADE,
  unite        text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chauffeur_id, article_id)
);

-- Déclencheur générique updated_at ------------------------------------------
CREATE OR REPLACE FUNCTION bon.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
      'utilisateurs','camions','chauffeurs','clients','contacts','projets',
      'sites','articles','lettres_voiture','tours','tour_lignes'])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_touch ON bon.%1$I;'
      'CREATE TRIGGER trg_touch BEFORE UPDATE ON bon.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION bon.touch_updated_at();', t);
  END LOOP;
END $$;
