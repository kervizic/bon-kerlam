-- @migration:     0026_beta28_tour_adresses_chantier
-- @description:   (beta.28) Adresses de chantier portées par le TOUR (texte + GPS),
--                 sans jamais créer de site. Le chargement/déchargement d'un tour
--                 peut être soit un site permanent (site_*_id) soit une adresse de
--                 chantier libre (*_adresse + *_lat/_lon). Pré-remplissage étendu :
--                 chargement = livraison du tour précédent (site OU adresse) ; et si
--                 cette livraison précédente était un site permanent, la nouvelle
--                 livraison est pré-remplie avec la dernière adresse de chantier du
--                 bon (le camion y retourne), sinon laissée vide. RPC des adresses de
--                 chantier déjà utilisées (pour le sélecteur, triées même client d'abord).
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0026_down.sql

-- 1. Colonnes d'adresse de chantier sur le tour (symétriques chargement/déchargement).
ALTER TABLE bon.tours
  ADD COLUMN IF NOT EXISTS chargement_adresse   text,
  ADD COLUMN IF NOT EXISTS chargement_lat       double precision,
  ADD COLUMN IF NOT EXISTS chargement_lon       double precision,
  ADD COLUMN IF NOT EXISTS dechargement_adresse text,
  ADD COLUMN IF NOT EXISTS dechargement_lat     double precision,
  ADD COLUMN IF NOT EXISTS dechargement_lon     double precision;

-- 2. Vue api.tours : SELECT * figé à la création -> recréer pour exposer les colonnes.
CREATE OR REPLACE VIEW api.tours WITH (security_invoker = true) AS
  SELECT * FROM bon.tours;
ALTER VIEW api.tours OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tours TO authenticated;

-- 3. Pré-remplissage étendu (BEFORE INSERT). Remplace la version de 0012.
CREATE OR REPLACE FUNCTION bon.trg_tour_prefill() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_prev bon.tours;
  v_prev_dech_commun boolean := false;
  v_last_chantier RECORD;
BEGIN
  SELECT * INTO v_prev
    FROM bon.tours
   WHERE lv_id = NEW.lv_id AND deleted_at IS NULL
   ORDER BY ordre DESC, id DESC
   LIMIT 1;

  -- Ordre séquentiel.
  NEW.ordre := COALESCE(v_prev.ordre, 0) + 1;

  IF FOUND THEN
    -- Chargement = livraison du tour précédent (site permanent OU adresse de
    -- chantier), seulement si le chargement n'a pas été fourni.
    IF NEW.site_chargement_id IS NULL AND NEW.chargement_adresse IS NULL THEN
      NEW.site_chargement_id := v_prev.site_dechargement_id;
      NEW.chargement_adresse := v_prev.dechargement_adresse;
      NEW.chargement_lat     := v_prev.dechargement_lat;
      NEW.chargement_lon     := v_prev.dechargement_lon;
    END IF;

    -- Livraison : si la livraison précédente était un SITE PERMANENT (commun) et que
    -- la livraison n'a pas été fournie, pré-remplir avec la dernière adresse de
    -- chantier livrée dans le bon. Sinon, laisser vide.
    IF NEW.site_dechargement_id IS NULL AND NEW.dechargement_adresse IS NULL THEN
      SELECT (s.portee = 'commun') INTO v_prev_dech_commun
        FROM bon.sites s WHERE s.id = v_prev.site_dechargement_id;
      IF COALESCE(v_prev_dech_commun, false) THEN
        SELECT t.dechargement_adresse AS adresse, t.dechargement_lat AS lat,
               t.dechargement_lon AS lon
          INTO v_last_chantier
          FROM bon.tours t
         WHERE t.lv_id = NEW.lv_id AND t.deleted_at IS NULL
           AND t.dechargement_adresse IS NOT NULL
         ORDER BY t.ordre DESC, t.id DESC
         LIMIT 1;
        IF FOUND THEN
          NEW.dechargement_adresse := v_last_chantier.adresse;
          NEW.dechargement_lat     := v_last_chantier.lat;
          NEW.dechargement_lon     := v_last_chantier.lon;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tour_prefill ON bon.tours;
CREATE TRIGGER trg_tour_prefill BEFORE INSERT ON bon.tours
  FOR EACH ROW EXECUTE FUNCTION bon.trg_tour_prefill();

-- 4. Adresses de chantier déjà utilisées (texte), par client du bon. Sert le
--    sélecteur : (1) même client d'abord, puis (2) autres clients, triées par
--    dernière utilisation. La RLS de bon.tours s'applique (un chauffeur ne voit
--    que les siennes). Rien à maintenir : dérivé des tours.
CREATE OR REPLACE FUNCTION bon.adresses_chantier(p_client_id bigint)
  RETURNS TABLE(adresse text, lat double precision, lon double precision,
                client_id bigint, derniere timestamptz, nb bigint)
  LANGUAGE sql STABLE AS $$
  WITH usages AS (
    SELECT t.chargement_adresse AS adresse, t.chargement_lat AS lat,
           t.chargement_lon AS lon, COALESCE(lv.client_id, p.client_id) AS cid,
           t.created_at AS used_at
      FROM bon.tours t
      JOIN bon.lettres_voiture lv ON lv.id = t.lv_id
      LEFT JOIN bon.projets p ON p.id = lv.projet_id
     WHERE t.deleted_at IS NULL AND lv.deleted_at IS NULL
       AND t.chargement_adresse IS NOT NULL
    UNION ALL
    SELECT t.dechargement_adresse, t.dechargement_lat, t.dechargement_lon,
           COALESCE(lv.client_id, p.client_id), t.created_at
      FROM bon.tours t
      JOIN bon.lettres_voiture lv ON lv.id = t.lv_id
      LEFT JOIN bon.projets p ON p.id = lv.projet_id
     WHERE t.deleted_at IS NULL AND lv.deleted_at IS NULL
       AND t.dechargement_adresse IS NOT NULL
  )
  SELECT (array_agg(adresse ORDER BY used_at DESC))[1] AS adresse,
         (array_agg(lat ORDER BY used_at DESC))[1] AS lat,
         (array_agg(lon ORDER BY used_at DESC))[1] AS lon,
         cid AS client_id,
         max(used_at) AS derniere,
         count(*) AS nb
    FROM usages
   GROUP BY lower(btrim(adresse)), cid
   ORDER BY (cid IS NOT DISTINCT FROM p_client_id) DESC, max(used_at) DESC
   LIMIT 500
$$;

CREATE OR REPLACE FUNCTION api.adresses_chantier(p_client_id bigint)
  RETURNS TABLE(adresse text, lat double precision, lon double precision,
                client_id bigint, derniere timestamptz, nb bigint)
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT * FROM bon.adresses_chantier(p_client_id)
$$;
GRANT EXECUTE ON FUNCTION api.adresses_chantier(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
