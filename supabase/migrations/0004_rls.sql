-- @migration:     0004_rls
-- @description:   Liste blanche + RLS. Un e-mail non listé (ou désactivé) ne voit
--                 RIEN. Rôles chauffeur / bureau. RLS SANS FORCE (owner et
--                 service_role conservent l'accès total ; service_role = BYPASSRLS).
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          ALTER TABLE ... DISABLE ROW LEVEL SECURITY ; DROP POLICY ...

-- Profil de l'acteur courant (liste blanche active). SECURITY DEFINER pour lire
-- bon.utilisateurs malgré sa propre RLS.
CREATE OR REPLACE FUNCTION bon.me() RETURNS bon.utilisateurs
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT * FROM bon.utilisateurs
   WHERE lower(email) = lower(bon.current_actor())
     AND actif = true AND role <> 'desactive'
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION bon.my_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT (bon.me()).role::text $$;

CREATE OR REPLACE FUNCTION bon.is_bureau() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT bon.my_role() = 'bureau' $$;

CREATE OR REPLACE FUNCTION bon.is_chauffeur() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT bon.my_role() = 'chauffeur' $$;

CREATE OR REPLACE FUNCTION bon.is_member() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT bon.my_role() IN ('bureau','chauffeur') $$;

CREATE OR REPLACE FUNCTION bon.my_chauffeur_id() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT id FROM bon.chauffeurs
   WHERE lower(email) = lower(bon.current_actor()) AND actif = true
   ORDER BY id LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION
  bon.me(), bon.my_role(), bon.is_bureau(), bon.is_chauffeur(),
  bon.is_member(), bon.my_chauffeur_id(), bon.current_actor(), bon.via_ia(),
  bon.attribuer_numero(bigint), bon.lv_poids(bigint),
  bon.ligne_tonnes(numeric, text, numeric, numeric),
  bon.haversine_m(double precision, double precision, double precision, double precision),
  bon.site_doublon(double precision, double precision, double precision, bigint),
  bon.sites_pour(bigint, bigint), bon.prefill(bigint),
  bon.set_derniere_unite(bigint, bigint, text), bon.derniere_unite_de(bigint, bigint),
  bon.lv_undo(bigint)
  TO authenticated, service_role;

-- Droits de table (RLS filtre ensuite les lignes). anon : aucun accès.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bon TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bon TO service_role;

-- Activation RLS (sans FORCE) -----------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
      'utilisateurs','camions','chauffeurs','clients','contacts','projets',
      'sites','articles','lettres_voiture','tours','tour_lignes',
      'derniere_unite','audit_log','lv_counter'])
  LOOP
    EXECUTE format('ALTER TABLE bon.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- Utilisateurs : bureau total ; chacun voit sa propre fiche.
CREATE POLICY util_select ON bon.utilisateurs FOR SELECT TO authenticated
  USING (bon.is_bureau() OR lower(email) = lower(bon.current_actor()));
CREATE POLICY util_write ON bon.utilisateurs FOR ALL TO authenticated
  USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());

-- Référentiels en lecture pour tout membre ; écriture au bureau.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['camions','chauffeurs','clients','contacts','projets']) LOOP
    EXECUTE format($f$
      CREATE POLICY %1$s_select ON bon.%1$s FOR SELECT TO authenticated
        USING (bon.is_member());
      CREATE POLICY %1$s_write ON bon.%1$s FOR ALL TO authenticated
        USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());
    $f$, t);
  END LOOP;
END $$;

-- Sites : lecture pour tout membre ; le chauffeur peut créer un chantier.
CREATE POLICY sites_select ON bon.sites FOR SELECT TO authenticated
  USING (bon.is_member());
CREATE POLICY sites_insert ON bon.sites FOR INSERT TO authenticated
  WITH CHECK (bon.is_bureau() OR (bon.is_chauffeur() AND portee = 'chantier'));
CREATE POLICY sites_update ON bon.sites FOR UPDATE TO authenticated
  USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());
CREATE POLICY sites_delete ON bon.sites FOR DELETE TO authenticated
  USING (bon.is_bureau());

-- Articles : lecture pour tout membre ; chauffeur et bureau peuvent créer.
CREATE POLICY articles_select ON bon.articles FOR SELECT TO authenticated
  USING (bon.is_member());
CREATE POLICY articles_insert ON bon.articles FOR INSERT TO authenticated
  WITH CHECK (bon.is_member());
CREATE POLICY articles_update ON bon.articles FOR UPDATE TO authenticated
  USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());
CREATE POLICY articles_delete ON bon.articles FOR DELETE TO authenticated
  USING (bon.is_bureau());

-- Lettres de voiture : chauffeur = ses bons ; bureau = tout. LV signée figée.
CREATE POLICY lv_select ON bon.lettres_voiture FOR SELECT TO authenticated
  USING (bon.is_bureau() OR lower(owner_email) = lower(bon.current_actor()));
CREATE POLICY lv_insert ON bon.lettres_voiture FOR INSERT TO authenticated
  WITH CHECK (bon.is_bureau()
    OR (bon.is_chauffeur() AND lower(owner_email) = lower(bon.current_actor())));
CREATE POLICY lv_update ON bon.lettres_voiture FOR UPDATE TO authenticated
  USING (bon.is_bureau()
    OR (lower(owner_email) = lower(bon.current_actor()) AND statut <> 'signee'))
  WITH CHECK (bon.is_bureau()
    OR lower(owner_email) = lower(bon.current_actor()));
CREATE POLICY lv_delete ON bon.lettres_voiture FOR DELETE TO authenticated
  USING (bon.is_bureau() OR lower(owner_email) = lower(bon.current_actor()));

-- Helper : la LV parente est-elle visible / modifiable ?
CREATE OR REPLACE FUNCTION bon.lv_visible(p_lv_id bigint) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM bon.lettres_voiture lv
     WHERE lv.id = p_lv_id
       AND (bon.is_bureau() OR lower(lv.owner_email) = lower(bon.current_actor())))
$$;
CREATE OR REPLACE FUNCTION bon.lv_modifiable(p_lv_id bigint) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM bon.lettres_voiture lv
     WHERE lv.id = p_lv_id AND lv.statut <> 'signee'
       AND (bon.is_bureau() OR lower(lv.owner_email) = lower(bon.current_actor())))
$$;
GRANT EXECUTE ON FUNCTION bon.lv_visible(bigint), bon.lv_modifiable(bigint)
  TO authenticated, service_role;

-- Tours : rattachés à une LV visible.
CREATE POLICY tours_select ON bon.tours FOR SELECT TO authenticated
  USING (bon.lv_visible(lv_id));
CREATE POLICY tours_insert ON bon.tours FOR INSERT TO authenticated
  WITH CHECK (bon.lv_modifiable(lv_id));
CREATE POLICY tours_update ON bon.tours FOR UPDATE TO authenticated
  USING (bon.lv_modifiable(lv_id)) WITH CHECK (bon.lv_modifiable(lv_id));
CREATE POLICY tours_delete ON bon.tours FOR DELETE TO authenticated
  USING (bon.lv_modifiable(lv_id));

-- Lignes : rattachées à un tour d'une LV visible.
CREATE OR REPLACE FUNCTION bon.tour_lv(p_tour_id bigint) RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  SELECT lv_id FROM bon.tours WHERE id = p_tour_id
$$;
GRANT EXECUTE ON FUNCTION bon.tour_lv(bigint) TO authenticated, service_role;

CREATE POLICY lignes_select ON bon.tour_lignes FOR SELECT TO authenticated
  USING (bon.lv_visible(bon.tour_lv(tour_id)));
CREATE POLICY lignes_insert ON bon.tour_lignes FOR INSERT TO authenticated
  WITH CHECK (bon.lv_modifiable(bon.tour_lv(tour_id)));
CREATE POLICY lignes_update ON bon.tour_lignes FOR UPDATE TO authenticated
  USING (bon.lv_modifiable(bon.tour_lv(tour_id)))
  WITH CHECK (bon.lv_modifiable(bon.tour_lv(tour_id)));
CREATE POLICY lignes_delete ON bon.tour_lignes FOR DELETE TO authenticated
  USING (bon.lv_modifiable(bon.tour_lv(tour_id)));

-- Mémoire d'unité : propre au chauffeur ; bureau en lecture.
CREATE POLICY du_select ON bon.derniere_unite FOR SELECT TO authenticated
  USING (bon.is_bureau() OR chauffeur_id = bon.my_chauffeur_id());
CREATE POLICY du_write ON bon.derniere_unite FOR ALL TO authenticated
  USING (chauffeur_id = bon.my_chauffeur_id())
  WITH CHECK (chauffeur_id = bon.my_chauffeur_id());

-- Audit : lecture si LV visible ; insert par les triggers (SECURITY DEFINER).
CREATE POLICY audit_select ON bon.audit_log FOR SELECT TO authenticated
  USING (bon.is_bureau() OR bon.lv_visible(lv_id));

-- Compteur : lecture seule pour les membres (écriture via fonction DEFINER).
CREATE POLICY counter_select ON bon.lv_counter FOR SELECT TO authenticated
  USING (bon.is_member());
