-- @migration:     0002_functions
-- @description:   Règles métier en SQL : numérotation atomique, estimation de
--                 poids/PTAC, anti-doublon géo, liste de sites, pré-remplissage,
--                 mémoire de la dernière unité.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP des fonctions bon.* créées ici.

-- ------------------------------------------------------------------ NUMÉROTATION
-- Numéro KER-##### (5 chiffres, continu à partir de 3000), attribué au PREMIER
-- TOUR seulement. Verrou de ligne sur le compteur => aucun trou, aucune course.
-- Idempotent : si la LV a déjà un numéro, on le renvoie sans consommer.
CREATE OR REPLACE FUNCTION bon.attribuer_numero(p_lv_id bigint)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = bon, pg_temp
AS $$
DECLARE
  v_numero text;
  v_value  integer;
BEGIN
  SELECT numero INTO v_numero FROM bon.lettres_voiture WHERE id = p_lv_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lettre de voiture introuvable: %', p_lv_id;
  END IF;
  IF v_numero IS NOT NULL THEN
    RETURN v_numero;                      -- déjà numérotée
  END IF;

  UPDATE bon.lv_counter
     SET next_value = next_value + 1
   WHERE id = 1
  RETURNING next_value - 1 INTO v_value;  -- valeur consommée

  v_numero := 'KER-' || to_char(v_value, 'FM00000');
  UPDATE bon.lettres_voiture SET numero = v_numero WHERE id = p_lv_id;
  RETURN v_numero;
END $$;

-- Au premier tour inséré, la LV reçoit son numéro.
CREATE OR REPLACE FUNCTION bon.trg_tour_attribue_numero() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
BEGIN
  PERFORM bon.attribuer_numero(NEW.lv_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tour_numero ON bon.tours;
CREATE TRIGGER trg_tour_numero
  AFTER INSERT ON bon.tours
  FOR EACH ROW EXECUTE FUNCTION bon.trg_tour_attribue_numero();

-- ------------------------------------------------------------------------ POIDS
-- Conversion d'une ligne en tonnes (NULL = non convertible => poids partiel).
CREATE OR REPLACE FUNCTION bon.ligne_tonnes(
  p_quantite numeric, p_unite text,
  p_densite_t_m3 numeric, p_poids_unitaire_t numeric)
  RETURNS numeric
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(p_unite, ''))
    WHEN 't'      THEN p_quantite
    WHEN 'tonne'  THEN p_quantite
    WHEN 'tonnes' THEN p_quantite
    WHEN 'm3'     THEN CASE WHEN p_densite_t_m3     IS NOT NULL THEN p_quantite * p_densite_t_m3     END
    WHEN 'm³'     THEN CASE WHEN p_densite_t_m3     IS NOT NULL THEN p_quantite * p_densite_t_m3     END
    WHEN 'unite'  THEN CASE WHEN p_poids_unitaire_t IS NOT NULL THEN p_quantite * p_poids_unitaire_t END
    WHEN 'unité'  THEN CASE WHEN p_poids_unitaire_t IS NOT NULL THEN p_quantite * p_poids_unitaire_t END
    WHEN 'u'      THEN CASE WHEN p_poids_unitaire_t IS NOT NULL THEN p_quantite * p_poids_unitaire_t END
    ELSE NULL
  END
$$;

-- Estimation de poids d'une LV vs PTAC. Simple affichage, aucun blocage.
-- gauge : 'ok' (<100 %), 'warn' (>=100 %), 'danger' (>=105 %).
CREATE OR REPLACE FUNCTION bon.lv_poids(p_lv_id bigint)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_poids_vide_t   numeric := 0;
  v_ptac_t         numeric;
  v_chargement_t   numeric := 0;
  v_non_comptees   integer := 0;
  v_partiel        boolean := false;
  v_ratio          numeric;
  v_gauge          text := 'ok';
  r                record;
  v_t              numeric;
BEGIN
  SELECT c.poids_vide_kg::numeric / 1000.0,
         NULLIF(c.ptac_kg, 0)::numeric / 1000.0
    INTO v_poids_vide_t, v_ptac_t
    FROM bon.lettres_voiture lv
    LEFT JOIN bon.camions c ON c.id = lv.camion_id
   WHERE lv.id = p_lv_id;
  v_poids_vide_t := COALESCE(v_poids_vide_t, 0);

  FOR r IN
    SELECT tl.quantite, tl.unite, a.densite_t_m3, a.poids_unitaire_t
      FROM bon.tour_lignes tl
      JOIN bon.tours t ON t.id = tl.tour_id AND t.deleted_at IS NULL
      LEFT JOIN bon.articles a ON a.id = tl.article_id
     WHERE t.lv_id = p_lv_id
  LOOP
    v_t := bon.ligne_tonnes(r.quantite, r.unite, r.densite_t_m3, r.poids_unitaire_t);
    IF v_t IS NULL THEN
      v_partiel := true;
      v_non_comptees := v_non_comptees + 1;
    ELSE
      v_chargement_t := v_chargement_t + v_t;
    END IF;
  END LOOP;

  IF v_ptac_t IS NOT NULL AND v_ptac_t > 0 THEN
    v_ratio := (v_poids_vide_t + v_chargement_t) / v_ptac_t;
    IF v_ratio >= 1.05 THEN v_gauge := 'danger';
    ELSIF v_ratio >= 1.00 THEN v_gauge := 'warn';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'poids_vide_t',    round(v_poids_vide_t, 3),
    'chargement_t',    round(v_chargement_t, 3),
    'masse_totale_t',  round(v_poids_vide_t + v_chargement_t, 3),
    'ptac_t',          CASE WHEN v_ptac_t IS NULL THEN NULL ELSE round(v_ptac_t, 3) END,
    'ratio',           CASE WHEN v_ratio  IS NULL THEN NULL ELSE round(v_ratio, 4) END,
    'gauge',           v_gauge,
    'poids_partiel',   v_partiel,
    'lignes_non_comptees', v_non_comptees
  );
END $$;

-- -------------------------------------------------------------------------- GÉO
CREATE OR REPLACE FUNCTION bon.haversine_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision)
  RETURNS double precision
  LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000.0 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

-- Sites existants à moins de rayon_m (anti-doublon, défaut 100 m).
CREATE OR REPLACE FUNCTION bon.site_doublon(
  p_lat double precision, p_lon double precision,
  p_rayon_m double precision DEFAULT 100.0, p_exclude_id bigint DEFAULT NULL)
  RETURNS TABLE (id bigint, nom text, distance_m double precision)
  LANGUAGE sql STABLE AS $$
  SELECT s.id, s.nom, bon.haversine_m(p_lat, p_lon, s.lat, s.lon) AS distance_m
    FROM bon.sites s
   WHERE s.lat IS NOT NULL AND s.lon IS NOT NULL
     AND (p_exclude_id IS NULL OR s.id <> p_exclude_id)
     AND bon.haversine_m(p_lat, p_lon, s.lat, s.lon) < p_rayon_m
   ORDER BY distance_m
$$;

-- ----------------------------------------------------------------- LISTE SITES
-- Ordre : 5 derniers sites du chauffeur pour ce client, puis chantiers du client,
-- puis sites communs par fréquence d'usage. « source » = 1/2/3 pour l'UI.
CREATE OR REPLACE FUNCTION bon.sites_pour(
  p_chauffeur_id bigint, p_client_id bigint)
  RETURNS TABLE (id bigint, nom text, adresse text, source integer, rang integer)
  LANGUAGE sql STABLE AS $$
  WITH derniers AS (
    SELECT s.id, s.nom, s.adresse, 1 AS source,
           row_number() OVER (ORDER BY max(t.created_at) DESC) AS rang
      FROM bon.sites s
      JOIN bon.tours t
        ON t.site_chargement_id = s.id OR t.site_dechargement_id = s.id
      JOIN bon.lettres_voiture lv ON lv.id = t.lv_id
      JOIN bon.projets p ON p.id = lv.projet_id
     WHERE lv.chauffeur_id = p_chauffeur_id
       AND p.client_id = p_client_id
       AND s.statut = 'actif'
     GROUP BY s.id, s.nom, s.adresse
     ORDER BY max(t.created_at) DESC
     LIMIT 5
  ),
  chantiers AS (
    SELECT s.id, s.nom, s.adresse, 2 AS source,
           row_number() OVER (ORDER BY s.nom) AS rang
      FROM bon.sites s
     WHERE s.portee = 'chantier' AND s.client_id = p_client_id
       AND s.statut = 'actif'
       AND s.id NOT IN (SELECT id FROM derniers)
  ),
  communs AS (
    SELECT s.id, s.nom, s.adresse, 3 AS source,
           row_number() OVER (
             ORDER BY count(t.id) DESC, s.nom) AS rang
      FROM bon.sites s
      LEFT JOIN bon.tours t
        ON t.site_chargement_id = s.id OR t.site_dechargement_id = s.id
     WHERE s.portee = 'commun' AND s.statut = 'actif'
       AND s.id NOT IN (SELECT id FROM derniers)
     GROUP BY s.id, s.nom, s.adresse
  )
  SELECT id, nom, adresse, source, rang FROM derniers
  UNION ALL
  SELECT id, nom, adresse, source, rang FROM chantiers
  UNION ALL
  SELECT id, nom, adresse, source, rang FROM communs
  ORDER BY source, rang
$$;

-- -------------------------------------------------------- PRÉ-REMPLISSAGE
-- Une LV PRÉPARÉE par le bureau pour aujourd'hui prime. Sinon on reprend le
-- dernier bon du chauffeur (client/projet/contact) + son camion attribué.
CREATE OR REPLACE FUNCTION bon.prefill(p_chauffeur_id bigint)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_prep   bon.lettres_voiture;
  v_last   bon.lettres_voiture;
  v_camion bigint;
BEGIN
  SELECT * INTO v_prep
    FROM bon.lettres_voiture
   WHERE chauffeur_id = p_chauffeur_id
     AND preparee = true
     AND date_etablissement = CURRENT_DATE
     AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'source', 'preparee',
      'lv_id', v_prep.id,
      'date_etablissement', v_prep.date_etablissement,
      'camion_id', v_prep.camion_id,
      'projet_id', v_prep.projet_id,
      'contact_id', v_prep.contact_id,
      'expediteur', v_prep.expediteur,
      'destinataire', v_prep.destinataire);
  END IF;

  SELECT camion_id INTO v_camion FROM bon.chauffeurs WHERE id = p_chauffeur_id;

  SELECT * INTO v_last
    FROM bon.lettres_voiture
   WHERE chauffeur_id = p_chauffeur_id
     AND deleted_at IS NULL
   ORDER BY date_etablissement DESC, created_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'source', 'dernier_bon',
    'date_etablissement', CURRENT_DATE,
    'camion_id', COALESCE(v_last.camion_id, v_camion),
    'projet_id', v_last.projet_id,
    'contact_id', v_last.contact_id);
END $$;

-- ----------------------------------------------------- MÉMOIRE DERNIÈRE UNITÉ
CREATE OR REPLACE FUNCTION bon.set_derniere_unite(
  p_chauffeur_id bigint, p_article_id bigint, p_unite text)
  RETURNS void
  LANGUAGE sql AS $$
  INSERT INTO bon.derniere_unite (chauffeur_id, article_id, unite, updated_at)
  VALUES (p_chauffeur_id, p_article_id, p_unite, now())
  ON CONFLICT (chauffeur_id, article_id)
  DO UPDATE SET unite = EXCLUDED.unite, updated_at = now()
$$;

CREATE OR REPLACE FUNCTION bon.derniere_unite_de(
  p_chauffeur_id bigint, p_article_id bigint)
  RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT unite FROM bon.derniere_unite
   WHERE chauffeur_id = p_chauffeur_id AND article_id = p_article_id
$$;

-- À chaque ligne saisie, on mémorise l'unité pour (chauffeur du bon, article).
CREATE OR REPLACE FUNCTION bon.trg_ligne_memorise_unite() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE v_chauffeur bigint;
BEGIN
  IF NEW.unite IS NULL OR NEW.article_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT lv.chauffeur_id INTO v_chauffeur
    FROM bon.tours t JOIN bon.lettres_voiture lv ON lv.id = t.lv_id
   WHERE t.id = NEW.tour_id;
  IF v_chauffeur IS NOT NULL THEN
    PERFORM bon.set_derniere_unite(v_chauffeur, NEW.article_id, NEW.unite);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ligne_unite ON bon.tour_lignes;
CREATE TRIGGER trg_ligne_unite
  AFTER INSERT OR UPDATE OF unite, article_id ON bon.tour_lignes
  FOR EACH ROW EXECUTE FUNCTION bon.trg_ligne_memorise_unite();
