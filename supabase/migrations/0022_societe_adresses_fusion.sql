-- @migration:     0022_societe_adresses_fusion
-- @description:   (beta.22) Modèle « société -> adresses » pour les CLIENTS
--                 (table bon.client_adresses) et pour les SITES de chargement
--                 (table bon.site_societes + bon.sites.societe_id). Mécanisme de
--                 FUSION de doublons réversible et journalisé (bon.fusions +
--                 fonctions api.fusionner_* / api.fusion_annuler), alias de
--                 recherche multi-valués (bon.aliases), et vues de DÉTECTION de
--                 doublons probables (api.doublons_clients / api.doublons_sites).
--                 Entièrement ADDITIVE et idempotente : aucune donnée existante
--                 n'est supprimée ni renommée ; les lettres gardent leurs clés.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0022_down.sql (script de retour arrière testé)

-- Similarité de noms (détection de doublons) ---------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================================
-- 1) CLIENTS : société (= bon.clients) -> 1..N adresses
-- =====================================================================
CREATE TABLE IF NOT EXISTS bon.client_adresses (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id     bigint NOT NULL REFERENCES bon.clients(id) ON DELETE CASCADE,
  libelle       text,                     -- ex : « Épinay », « Noisy », « Principale »
  adresse       text,
  lat           double precision,
  lon           double precision,
  is_principale boolean NOT NULL DEFAULT false,
  actif         boolean NOT NULL DEFAULT true,
  created_by    text DEFAULT bon.current_actor(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_adresses_client_idx ON bon.client_adresses (client_id);

-- Marqueurs de fusion sur la société cliente (réversible via bon.fusions).
ALTER TABLE bon.clients ADD COLUMN IF NOT EXISTS merged_into_id bigint
  REFERENCES bon.clients(id) ON DELETE SET NULL;
ALTER TABLE bon.clients ADD COLUMN IF NOT EXISTS merged_at timestamptz;

-- Reprise douce : 1 adresse par client existant qui en a une et n'en a pas déjà.
INSERT INTO bon.client_adresses (client_id, libelle, adresse, is_principale, created_by)
SELECT c.id, 'Principale', c.adresse, true, 'migration-0022'
  FROM bon.clients c
 WHERE COALESCE(c.adresse, '') <> ''
   AND NOT EXISTS (SELECT 1 FROM bon.client_adresses a WHERE a.client_id = c.id);

-- Adresse choisie sur la lettre (expéditeur = client ; destinataire = client).
-- Nullable : les lettres existantes et les PDF signés ne changent pas.
ALTER TABLE bon.lettres_voiture ADD COLUMN IF NOT EXISTS client_adresse_id bigint
  REFERENCES bon.client_adresses(id) ON DELETE SET NULL;
ALTER TABLE bon.lettres_voiture ADD COLUMN IF NOT EXISTS dest_adresse_id bigint
  REFERENCES bon.client_adresses(id) ON DELETE SET NULL;

-- =====================================================================
-- 2) SITES : société de sites -> 1..N adresses (= bon.sites)
-- =====================================================================
CREATE TABLE IF NOT EXISTS bon.site_societes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom            text NOT NULL,
  siren          text,
  merged_into_id bigint REFERENCES bon.site_societes(id) ON DELETE SET NULL,
  merged_at      timestamptz,
  actif          boolean NOT NULL DEFAULT true,
  created_by     text DEFAULT bon.current_actor(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Unicité du nom parmi les sociétés NON fusionnées (upserts idempotents par nom).
CREATE UNIQUE INDEX IF NOT EXISTS site_societes_nom_uidx
  ON bon.site_societes (lower(nom)) WHERE merged_into_id IS NULL;

-- Rattachement d'une adresse (site) à sa société + marqueurs de fusion de site.
ALTER TABLE bon.sites ADD COLUMN IF NOT EXISTS societe_id bigint
  REFERENCES bon.site_societes(id) ON DELETE SET NULL;
ALTER TABLE bon.sites ADD COLUMN IF NOT EXISTS merged_into_id bigint
  REFERENCES bon.sites(id) ON DELETE SET NULL;
ALTER TABLE bon.sites ADD COLUMN IF NOT EXISTS merged_at timestamptz;
CREATE INDEX IF NOT EXISTS sites_societe_idx ON bon.sites (societe_id);

-- =====================================================================
-- 3) Alias de recherche multi-valués (jamais imprimés sur la LV)
-- =====================================================================
CREATE TABLE IF NOT EXISTS bon.aliases (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cible_type  text NOT NULL CHECK (cible_type IN ('client','site','site_societe')),
  cible_id    bigint NOT NULL,
  alias       text NOT NULL,
  origine     text,                       -- 'fusion' | 'manuel' | 'migration'
  fusion_id   bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aliases_cible_idx ON bon.aliases (cible_type, cible_id);
CREATE INDEX IF NOT EXISTS aliases_trgm_idx  ON bon.aliases USING gin (alias gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS aliases_uidx
  ON bon.aliases (cible_type, cible_id, lower(alias));

-- Reprise : l'alias simple déjà posé sur les clients (0018) devient un alias
-- de recherche multi-valué (idempotent).
INSERT INTO bon.aliases (cible_type, cible_id, alias, origine)
SELECT 'client', c.id, c.alias, 'migration'
  FROM bon.clients c
 WHERE COALESCE(c.alias, '') <> ''
   AND NOT EXISTS (
     SELECT 1 FROM bon.aliases a
      WHERE a.cible_type = 'client' AND a.cible_id = c.id
        AND lower(a.alias) = lower(c.alias));

-- =====================================================================
-- 4) Journal de fusion (réversibilité)
-- =====================================================================
CREATE TABLE IF NOT EXISTS bon.fusions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('client','site','site_societe')),
  garde_id    bigint NOT NULL,
  fusionne_id bigint NOT NULL,
  snapshot    jsonb NOT NULL,             -- état avant fusion, pour annulation
  par         text DEFAULT bon.current_actor(),
  cree_at     timestamptz NOT NULL DEFAULT now(),
  annulee_at  timestamptz,
  annulee_par text
);
CREATE INDEX IF NOT EXISTS fusions_actives_idx ON bon.fusions (type, annulee_at);

-- =====================================================================
-- 5) Fonctions de fusion / annulation
-- =====================================================================

-- --- CLIENTS -----------------------------------------------------------------
-- Fusionne p_fusionnes[] dans p_garde : réaffecte lettres (expéditeur +
-- destinataire), adresses, contacts et projets vers la société gardée ; le nom
-- fusionné (et ses alias) deviennent des alias de recherche ; la société
-- fusionnée est désactivée (merged_into_id). Journalisé + réversible.
CREATE OR REPLACE FUNCTION bon.fusionner_clients(p_garde bigint, p_fusionnes bigint[])
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_actor   text := bon.current_actor();
  v_f       bigint;
  v_snap    jsonb;
  v_lv_c    bigint[];
  v_lv_d    bigint[];
  v_adr     bigint[];
  v_contact bigint[];
  v_projet  bigint[];
  v_alias   bigint[];
  v_fusion  bigint;
  v_done    int := 0;
BEGIN
  IF p_garde IS NULL OR p_fusionnes IS NULL THEN
    RAISE EXCEPTION 'fusionner_clients: paramètres manquants';
  END IF;
  -- Contexte migration/worker (aucun acteur JWT) = de confiance ; un acteur
  -- réel doit être membre (bureau ou chauffeur).
  IF bon.current_actor() IS NOT NULL AND NOT bon.is_member() THEN
    RAISE EXCEPTION 'fusionner_clients: non autorisé';
  END IF;

  FOREACH v_f IN ARRAY p_fusionnes LOOP
    CONTINUE WHEN v_f = p_garde;
    -- la société fusionnée doit exister et ne pas être déjà fusionnée
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM bon.clients WHERE id = v_f AND merged_into_id IS NULL);

    SELECT array_agg(id) INTO v_lv_c
      FROM bon.lettres_voiture WHERE client_id = v_f;
    SELECT array_agg(id) INTO v_lv_d
      FROM bon.lettres_voiture WHERE destinataire_client_id = v_f;
    SELECT array_agg(id) INTO v_adr
      FROM bon.client_adresses WHERE client_id = v_f;
    SELECT array_agg(id) INTO v_contact
      FROM bon.contacts WHERE client_id = v_f;
    SELECT array_agg(id) INTO v_projet
      FROM bon.projets WHERE client_id = v_f;

    v_snap := jsonb_build_object(
      'client', (SELECT to_jsonb(c) FROM bon.clients c WHERE c.id = v_f),
      'lv_client', COALESCE(to_jsonb(v_lv_c), '[]'::jsonb),
      'lv_dest',   COALESCE(to_jsonb(v_lv_d), '[]'::jsonb),
      'adresses',  COALESCE(to_jsonb(v_adr), '[]'::jsonb),
      'adresses_detail', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', ca.id, 'is_principale', ca.is_principale))
          FROM bon.client_adresses ca WHERE ca.client_id = v_f), '[]'::jsonb),
      'contacts',  COALESCE(to_jsonb(v_contact), '[]'::jsonb),
      'projets',   COALESCE(to_jsonb(v_projet), '[]'::jsonb));

    -- réaffectations
    UPDATE bon.lettres_voiture SET client_id = p_garde WHERE client_id = v_f;
    UPDATE bon.lettres_voiture SET destinataire_client_id = p_garde
     WHERE destinataire_client_id = v_f;
    UPDATE bon.client_adresses SET client_id = p_garde, is_principale = false
     WHERE client_id = v_f;
    UPDATE bon.contacts SET client_id = p_garde WHERE client_id = v_f;
    UPDATE bon.projets  SET client_id = p_garde WHERE client_id = v_f;

    -- journal de fusion (avant d'ajouter les alias pour tracer fusion_id)
    INSERT INTO bon.fusions (type, garde_id, fusionne_id, snapshot, par)
    VALUES ('client', p_garde, v_f, v_snap, v_actor)
    RETURNING id INTO v_fusion;

    -- le nom et les alias existants de la société fusionnée deviennent des alias
    WITH src AS (
      SELECT raison_sociale AS a FROM bon.clients WHERE id = v_f
      UNION
      SELECT alias FROM bon.aliases
       WHERE cible_type = 'client' AND cible_id = v_f
    ), ins AS (
      INSERT INTO bon.aliases (cible_type, cible_id, alias, origine, fusion_id)
      SELECT 'client', p_garde, a, 'fusion', v_fusion FROM src
       WHERE COALESCE(a, '') <> ''
      ON CONFLICT (cible_type, cible_id, lower(alias)) DO NOTHING
      RETURNING id
    )
    SELECT array_agg(id) INTO v_alias FROM ins;

    UPDATE bon.fusions
       SET snapshot = snapshot || jsonb_build_object('alias_crees',
             COALESCE(to_jsonb(v_alias), '[]'::jsonb))
     WHERE id = v_fusion;

    -- désactivation de la société fusionnée (conservée pour l'historique)
    UPDATE bon.clients
       SET merged_into_id = p_garde, merged_at = now(), actif = false
     WHERE id = v_f;

    v_done := v_done + 1;
  END LOOP;

  RETURN jsonb_build_object('type', 'client', 'garde', p_garde, 'fusionnes', v_done);
END $$;

-- --- SOCIÉTÉS DE SITES -------------------------------------------------------
CREATE OR REPLACE FUNCTION bon.fusionner_site_societes(p_garde bigint, p_fusionnes bigint[])
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_actor  text := bon.current_actor();
  v_f      bigint;
  v_snap   jsonb;
  v_sites  bigint[];
  v_alias  bigint[];
  v_fusion bigint;
  v_done   int := 0;
BEGIN
  IF p_garde IS NULL OR p_fusionnes IS NULL THEN
    RAISE EXCEPTION 'fusionner_site_societes: paramètres manquants';
  END IF;
  -- Contexte migration/worker (aucun acteur JWT) = de confiance ; un acteur
  -- réel doit être membre (bureau ou chauffeur).
  IF bon.current_actor() IS NOT NULL AND NOT bon.is_member() THEN
    RAISE EXCEPTION 'fusionner_site_societes: non autorisé';
  END IF;

  FOREACH v_f IN ARRAY p_fusionnes LOOP
    CONTINUE WHEN v_f = p_garde;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM bon.site_societes WHERE id = v_f AND merged_into_id IS NULL);

    SELECT array_agg(id) INTO v_sites FROM bon.sites WHERE societe_id = v_f;
    v_snap := jsonb_build_object(
      'societe', (SELECT to_jsonb(s) FROM bon.site_societes s WHERE s.id = v_f),
      'sites', COALESCE(to_jsonb(v_sites), '[]'::jsonb));

    UPDATE bon.sites SET societe_id = p_garde WHERE societe_id = v_f;

    INSERT INTO bon.fusions (type, garde_id, fusionne_id, snapshot, par)
    VALUES ('site_societe', p_garde, v_f, v_snap, v_actor)
    RETURNING id INTO v_fusion;

    WITH src AS (
      SELECT nom AS a FROM bon.site_societes WHERE id = v_f
      UNION
      SELECT alias FROM bon.aliases
       WHERE cible_type = 'site_societe' AND cible_id = v_f
    ), ins AS (
      INSERT INTO bon.aliases (cible_type, cible_id, alias, origine, fusion_id)
      SELECT 'site_societe', p_garde, a, 'fusion', v_fusion FROM src
       WHERE COALESCE(a, '') <> ''
      ON CONFLICT (cible_type, cible_id, lower(alias)) DO NOTHING
      RETURNING id
    )
    SELECT array_agg(id) INTO v_alias FROM ins;

    UPDATE bon.fusions
       SET snapshot = snapshot || jsonb_build_object('alias_crees',
             COALESCE(to_jsonb(v_alias), '[]'::jsonb))
     WHERE id = v_fusion;

    UPDATE bon.site_societes
       SET merged_into_id = p_garde, merged_at = now(), actif = false
     WHERE id = v_f;

    v_done := v_done + 1;
  END LOOP;

  RETURN jsonb_build_object('type', 'site_societe', 'garde', p_garde, 'fusionnes', v_done);
END $$;

-- --- SITES (adresses) --------------------------------------------------------
-- Fusionne des adresses de site (doublon pur) : réaffecte les tours vers le site
-- gardé, le nom fusionné devient alias du site gardé, l'adresse fusionnée est
-- marquée mergée (sortie des listes, conservée pour l'historique et la recherche).
CREATE OR REPLACE FUNCTION bon.fusionner_sites(p_garde bigint, p_fusionnes bigint[])
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_actor  text := bon.current_actor();
  v_f      bigint;
  v_snap   jsonb;
  v_tc     bigint[];
  v_td     bigint[];
  v_alias  bigint[];
  v_fusion bigint;
  v_done   int := 0;
BEGIN
  IF p_garde IS NULL OR p_fusionnes IS NULL THEN
    RAISE EXCEPTION 'fusionner_sites: paramètres manquants';
  END IF;
  -- Contexte migration/worker (aucun acteur JWT) = de confiance ; un acteur
  -- réel doit être membre (bureau ou chauffeur).
  IF bon.current_actor() IS NOT NULL AND NOT bon.is_member() THEN
    RAISE EXCEPTION 'fusionner_sites: non autorisé';
  END IF;

  FOREACH v_f IN ARRAY p_fusionnes LOOP
    CONTINUE WHEN v_f = p_garde;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM bon.sites WHERE id = v_f AND merged_into_id IS NULL);

    SELECT array_agg(id) INTO v_tc FROM bon.tours WHERE site_chargement_id = v_f;
    SELECT array_agg(id) INTO v_td FROM bon.tours WHERE site_dechargement_id = v_f;
    v_snap := jsonb_build_object(
      'site', (SELECT to_jsonb(s) FROM bon.sites s WHERE s.id = v_f),
      'tours_chargement', COALESCE(to_jsonb(v_tc), '[]'::jsonb),
      'tours_dechargement', COALESCE(to_jsonb(v_td), '[]'::jsonb));

    UPDATE bon.tours SET site_chargement_id = p_garde WHERE site_chargement_id = v_f;
    UPDATE bon.tours SET site_dechargement_id = p_garde WHERE site_dechargement_id = v_f;

    INSERT INTO bon.fusions (type, garde_id, fusionne_id, snapshot, par)
    VALUES ('site', p_garde, v_f, v_snap, v_actor)
    RETURNING id INTO v_fusion;

    WITH src AS (
      SELECT nom AS a FROM bon.sites WHERE id = v_f
      UNION
      SELECT alias FROM bon.aliases WHERE cible_type = 'site' AND cible_id = v_f
    ), ins AS (
      INSERT INTO bon.aliases (cible_type, cible_id, alias, origine, fusion_id)
      SELECT 'site', p_garde, a, 'fusion', v_fusion FROM src
       WHERE COALESCE(a, '') <> ''
      ON CONFLICT (cible_type, cible_id, lower(alias)) DO NOTHING
      RETURNING id
    )
    SELECT array_agg(id) INTO v_alias FROM ins;

    UPDATE bon.fusions
       SET snapshot = snapshot || jsonb_build_object('alias_crees',
             COALESCE(to_jsonb(v_alias), '[]'::jsonb))
     WHERE id = v_fusion;

    UPDATE bon.sites
       SET merged_into_id = p_garde, merged_at = now(), statut = 'termine'
     WHERE id = v_f;

    v_done := v_done + 1;
  END LOOP;

  RETURN jsonb_build_object('type', 'site', 'garde', p_garde, 'fusionnes', v_done);
END $$;

-- --- ANNULATION (réversibilité) ----------------------------------------------
CREATE OR REPLACE FUNCTION bon.fusion_annuler(p_fusion_id bigint)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_actor text := bon.current_actor();
  v_fu    bon.fusions;
  v_snap  jsonb;
  v_id    bigint;
BEGIN
  -- Contexte migration/worker (aucun acteur JWT) = de confiance ; un acteur
  -- réel doit être membre (bureau ou chauffeur).
  IF bon.current_actor() IS NOT NULL AND NOT bon.is_member() THEN
    RAISE EXCEPTION 'fusion_annuler: non autorisé';
  END IF;
  SELECT * INTO v_fu FROM bon.fusions WHERE id = p_fusion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'fusion_annuler: fusion % introuvable', p_fusion_id; END IF;
  IF v_fu.annulee_at IS NOT NULL THEN
    RETURN jsonb_build_object('deja_annulee', true, 'fusion', p_fusion_id);
  END IF;
  v_snap := v_fu.snapshot;

  -- supprimer les alias créés par cette fusion
  DELETE FROM bon.aliases
   WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'alias_crees','[]'::jsonb)))::bigint);

  IF v_fu.type = 'client' THEN
    -- rétablir les clés réaffectées depuis le snapshot
    UPDATE bon.lettres_voiture SET client_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'lv_client','[]'::jsonb)))::bigint);
    UPDATE bon.lettres_voiture SET destinataire_client_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'lv_dest','[]'::jsonb)))::bigint);
    UPDATE bon.client_adresses SET client_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'adresses','[]'::jsonb)))::bigint);
    UPDATE bon.contacts SET client_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'contacts','[]'::jsonb)))::bigint);
    UPDATE bon.projets SET client_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'projets','[]'::jsonb)))::bigint);
    -- restaurer is_principale d'origine sur les adresses du fusionné
    UPDATE bon.client_adresses ca SET is_principale = (x.val->>'is_principale')::boolean
      FROM jsonb_array_elements(COALESCE(v_snap->'adresses_detail','[]'::jsonb)) AS x(val)
     WHERE ca.id = (x.val->>'id')::bigint;
    UPDATE bon.clients SET merged_into_id = NULL, merged_at = NULL,
           actif = COALESCE((v_snap->'client'->>'actif')::boolean, true)
     WHERE id = v_fu.fusionne_id;

  ELSIF v_fu.type = 'site_societe' THEN
    UPDATE bon.sites SET societe_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'sites','[]'::jsonb)))::bigint);
    UPDATE bon.site_societes SET merged_into_id = NULL, merged_at = NULL,
           actif = COALESCE((v_snap->'societe'->>'actif')::boolean, true)
     WHERE id = v_fu.fusionne_id;

  ELSIF v_fu.type = 'site' THEN
    UPDATE bon.tours SET site_chargement_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'tours_chargement','[]'::jsonb)))::bigint);
    UPDATE bon.tours SET site_dechargement_id = v_fu.fusionne_id
     WHERE id IN (SELECT (jsonb_array_elements_text(COALESCE(v_snap->'tours_dechargement','[]'::jsonb)))::bigint);
    UPDATE bon.sites SET merged_into_id = NULL, merged_at = NULL,
           statut = COALESCE((v_snap->'site'->>'statut'), 'actif')::bon.statut_site
     WHERE id = v_fu.fusionne_id;
  END IF;

  UPDATE bon.fusions SET annulee_at = now(), annulee_par = v_actor WHERE id = p_fusion_id;
  RETURN jsonb_build_object('annulee', true, 'type', v_fu.type,
                            'garde', v_fu.garde_id, 'fusionne', v_fu.fusionne_id);
END $$;

-- =====================================================================
-- 6) Vues API
-- =====================================================================
-- Clients enrichis : alias agrégés + nombre d'adresses (le front filtre actif).
CREATE OR REPLACE VIEW api.clients WITH (security_invoker = true) AS
  SELECT c.*,
    (SELECT array_agg(a.alias ORDER BY a.alias)
       FROM bon.aliases a WHERE a.cible_type = 'client' AND a.cible_id = c.id) AS aliases,
    (SELECT count(*) FROM bon.client_adresses ca
      WHERE ca.client_id = c.id AND ca.actif) AS nb_adresses
    FROM bon.clients c;
ALTER VIEW api.clients OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.clients TO authenticated;
GRANT SELECT ON api.clients TO service_role;

-- Adresses des clients.
CREATE OR REPLACE VIEW api.client_adresses WITH (security_invoker = true) AS
  SELECT * FROM bon.client_adresses;
ALTER VIEW api.client_adresses OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.client_adresses TO authenticated;
GRANT SELECT ON api.client_adresses TO service_role;

-- Sociétés de sites enrichies : alias agrégés + nombre d'adresses actives.
CREATE OR REPLACE VIEW api.site_societes WITH (security_invoker = true) AS
  SELECT ss.*,
    (SELECT array_agg(a.alias ORDER BY a.alias)
       FROM bon.aliases a WHERE a.cible_type = 'site_societe' AND a.cible_id = ss.id) AS aliases,
    (SELECT count(*) FROM bon.sites s
      WHERE s.societe_id = ss.id AND s.statut = 'actif' AND s.merged_into_id IS NULL) AS nb_adresses
    FROM bon.site_societes ss;
ALTER VIEW api.site_societes OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.site_societes TO authenticated;
GRANT SELECT ON api.site_societes TO service_role;

-- Vue sites rafraîchie (nouvelles colonnes societe_id/alias/merged exposées).
CREATE OR REPLACE VIEW api.sites WITH (security_invoker = true) AS
  SELECT * FROM bon.sites;
ALTER VIEW api.sites OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.sites TO authenticated;
GRANT SELECT ON api.sites TO service_role;

-- Lettres de voiture rafraîchie (nouvelles colonnes adresse exposées).
CREATE OR REPLACE VIEW api.lettres_voiture WITH (security_invoker = true) AS
  SELECT * FROM bon.lettres_voiture;
ALTER VIEW api.lettres_voiture OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.lettres_voiture TO authenticated;
GRANT SELECT ON api.lettres_voiture TO service_role;

-- Aliases + fusions (lecture pour l'UI ; écriture via RPC).
CREATE OR REPLACE VIEW api.aliases WITH (security_invoker = true) AS
  SELECT * FROM bon.aliases;
ALTER VIEW api.aliases OWNER TO postgres;
GRANT SELECT ON api.aliases TO authenticated, service_role;

CREATE OR REPLACE VIEW api.fusions WITH (security_invoker = true) AS
  SELECT * FROM bon.fusions;
ALTER VIEW api.fusions OWNER TO postgres;
GRANT SELECT ON api.fusions TO authenticated, service_role;

-- =====================================================================
-- 7) Détection de doublons probables (jamais de fusion automatique)
-- =====================================================================
-- Paires de clients actifs : même SIREN, OU nom proche (trigram >= 0.45),
-- OU adresse principale identique. Une paire par (a<b).
CREATE OR REPLACE VIEW api.doublons_clients WITH (security_invoker = true) AS
  SELECT a.id AS id_a, a.raison_sociale AS nom_a,
         b.id AS id_b, b.raison_sociale AS nom_b,
         (a.siren IS NOT NULL AND a.siren = b.siren)              AS meme_siren,
         similarity(a.raison_sociale, b.raison_sociale)           AS score_nom,
         EXISTS (SELECT 1 FROM bon.client_adresses xa
                   JOIN bon.client_adresses xb ON lower(trim(xa.adresse)) = lower(trim(xb.adresse))
                  WHERE xa.client_id = a.id AND xb.client_id = b.id
                    AND COALESCE(xa.adresse,'') <> '')             AS meme_adresse
    FROM bon.clients a
    JOIN bon.clients b ON a.id < b.id
   WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL
     AND a.actif AND b.actif
     AND ( (a.siren IS NOT NULL AND a.siren = b.siren)
        OR similarity(a.raison_sociale, b.raison_sociale) >= 0.45 );
GRANT SELECT ON api.doublons_clients TO authenticated, service_role;

-- Paires de sites actifs : nom proche, OU GPS proches (< 120 m),
-- OU adresse identique. Exclut les sites déjà rattachés à la même société.
CREATE OR REPLACE VIEW api.doublons_sites WITH (security_invoker = true) AS
  SELECT a.id AS id_a, a.nom AS nom_a, b.id AS id_b, b.nom AS nom_b,
         similarity(a.nom, b.nom) AS score_nom,
         CASE WHEN a.lat IS NOT NULL AND b.lat IS NOT NULL
              THEN bon.haversine_m(a.lat, a.lon, b.lat, b.lon) END AS distance_m,
         (lower(trim(COALESCE(a.adresse,''))) = lower(trim(COALESCE(b.adresse,'')))
          AND COALESCE(a.adresse,'') <> '')                        AS meme_adresse
    FROM bon.sites a
    JOIN bon.sites b ON a.id < b.id
   WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL
     AND a.statut = 'actif' AND b.statut = 'actif'
     AND COALESCE(a.societe_id, -1) <> COALESCE(b.societe_id, -2)
     AND ( similarity(a.nom, b.nom) >= 0.45
        OR (lower(trim(COALESCE(a.adresse,''))) = lower(trim(COALESCE(b.adresse,'')))
            AND COALESCE(a.adresse,'') <> '')
        OR (a.lat IS NOT NULL AND b.lat IS NOT NULL
            AND bon.haversine_m(a.lat, a.lon, b.lat, b.lon) < 120) );
GRANT SELECT ON api.doublons_sites TO authenticated, service_role;

-- =====================================================================
-- 8) RPC api.* (SECURITY INVOKER -> s'appuient sur les fonctions bon.*)
-- =====================================================================
CREATE OR REPLACE FUNCTION api.fusionner_clients(p_garde bigint, p_fusionnes bigint[])
  RETURNS jsonb LANGUAGE sql AS $$ SELECT bon.fusionner_clients(p_garde, p_fusionnes) $$;
CREATE OR REPLACE FUNCTION api.fusionner_site_societes(p_garde bigint, p_fusionnes bigint[])
  RETURNS jsonb LANGUAGE sql AS $$ SELECT bon.fusionner_site_societes(p_garde, p_fusionnes) $$;
CREATE OR REPLACE FUNCTION api.fusionner_sites(p_garde bigint, p_fusionnes bigint[])
  RETURNS jsonb LANGUAGE sql AS $$ SELECT bon.fusionner_sites(p_garde, p_fusionnes) $$;
CREATE OR REPLACE FUNCTION api.fusion_annuler(p_fusion_id bigint)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT bon.fusion_annuler(p_fusion_id) $$;

GRANT EXECUTE ON FUNCTION api.fusionner_clients(bigint, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION api.fusionner_site_societes(bigint, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION api.fusionner_sites(bigint, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION api.fusion_annuler(bigint) TO authenticated;

-- Déclencheur updated_at sur les nouvelles tables.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['client_adresses','site_societes']) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_touch ON bon.%1$I;'
      'CREATE TRIGGER trg_touch BEFORE UPDATE ON bon.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION bon.touch_updated_at();', t);
  END LOOP;
END $$;

-- =====================================================================
-- 9) Droits de table + RLS sur les nouvelles tables (vues security_invoker)
-- =====================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON bon.client_adresses, bon.site_societes
  TO authenticated, service_role;
-- aliases / fusions : écriture réservée aux fonctions SECURITY DEFINER.
GRANT SELECT ON bon.aliases, bon.fusions TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON bon.aliases, bon.fusions TO service_role;

GRANT EXECUTE ON FUNCTION
  bon.fusionner_clients(bigint, bigint[]),
  bon.fusionner_site_societes(bigint, bigint[]),
  bon.fusionner_sites(bigint, bigint[]),
  bon.fusion_annuler(bigint)
  TO authenticated, service_role;

ALTER TABLE bon.client_adresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bon.site_societes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bon.aliases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bon.fusions         ENABLE ROW LEVEL SECURITY;

-- Adresses des clients : lecture membre ; création membre ; modification bureau
-- ou créateur ; suppression bureau (comme les référentiels ouverts, cf. 0018).
DROP POLICY IF EXISTS client_adresses_select ON bon.client_adresses;
DROP POLICY IF EXISTS client_adresses_insert ON bon.client_adresses;
DROP POLICY IF EXISTS client_adresses_update ON bon.client_adresses;
DROP POLICY IF EXISTS client_adresses_delete ON bon.client_adresses;
CREATE POLICY client_adresses_select ON bon.client_adresses FOR SELECT TO authenticated
  USING (bon.is_member());
CREATE POLICY client_adresses_insert ON bon.client_adresses FOR INSERT TO authenticated
  WITH CHECK (bon.is_member());
CREATE POLICY client_adresses_update ON bon.client_adresses FOR UPDATE TO authenticated
  USING (bon.is_bureau()
    OR (bon.is_chauffeur()
        AND lower(coalesce(created_by,'')) = lower(coalesce(bon.current_actor(),''))))
  WITH CHECK (bon.is_bureau()
    OR (bon.is_chauffeur()
        AND lower(coalesce(created_by,'')) = lower(coalesce(bon.current_actor(),''))));
CREATE POLICY client_adresses_delete ON bon.client_adresses FOR DELETE TO authenticated
  USING (bon.is_bureau());

-- Sociétés de sites : lecture membre ; création membre ; modif/suppression bureau.
DROP POLICY IF EXISTS site_societes_select ON bon.site_societes;
DROP POLICY IF EXISTS site_societes_insert ON bon.site_societes;
DROP POLICY IF EXISTS site_societes_write  ON bon.site_societes;
CREATE POLICY site_societes_select ON bon.site_societes FOR SELECT TO authenticated
  USING (bon.is_member());
CREATE POLICY site_societes_insert ON bon.site_societes FOR INSERT TO authenticated
  WITH CHECK (bon.is_member());
CREATE POLICY site_societes_update ON bon.site_societes FOR UPDATE TO authenticated
  USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());
CREATE POLICY site_societes_delete ON bon.site_societes FOR DELETE TO authenticated
  USING (bon.is_bureau());

-- Alias / fusions : lecture membre (écriture via fonctions SECURITY DEFINER).
DROP POLICY IF EXISTS aliases_select ON bon.aliases;
DROP POLICY IF EXISTS fusions_select ON bon.fusions;
CREATE POLICY aliases_select ON bon.aliases FOR SELECT TO authenticated
  USING (bon.is_member());
CREATE POLICY fusions_select ON bon.fusions FOR SELECT TO authenticated
  USING (bon.is_member());

NOTIFY pgrst, 'reload schema';
