-- @migration:     0011_driver_documents
-- @description:   Documents réglementaires du chauffeur (permis, FCO/code 95,
--                 carte conducteur chrono, CACES) + scans dans un bucket Storage
--                 PRIVÉ. Lecture/écriture BUREAU uniquement (RLS). Alertes 60 j,
--                 retard de téléchargement carte conducteur, purge au départ.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP des tables bon.permis*, bon.fco, bon.carte_conducteur, bon.caces.

ALTER TABLE bon.chauffeurs ADD COLUMN IF NOT EXISTS date_sortie date;

-- Permis de conduire (un par chauffeur) + catégories datées -------------------
CREATE TABLE IF NOT EXISTS bon.permis (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chauffeur_id    bigint NOT NULL UNIQUE REFERENCES bon.chauffeurs(id) ON DELETE CASCADE,
  numero          text,
  visite_medicale date,
  scan_recto      text,          -- clé objet dans le bucket privé
  scan_verso      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bon.permis_categories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chauffeur_id bigint NOT NULL REFERENCES bon.chauffeurs(id) ON DELETE CASCADE,
  categorie    text NOT NULL,     -- B, C, CE, D...
  validite     date,
  UNIQUE (chauffeur_id, categorie)
);

-- Carte de qualification conducteur (FCO / code 95) --------------------------
CREATE TABLE IF NOT EXISTS bon.fco (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chauffeur_id bigint NOT NULL UNIQUE REFERENCES bon.chauffeurs(id) ON DELETE CASCADE,
  numero       text,
  delivrance   date,
  expiration   date,
  scan_recto   text,
  scan_verso   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Carte conducteur chronotachygraphe -----------------------------------------
CREATE TABLE IF NOT EXISTS bon.carte_conducteur (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chauffeur_id         bigint NOT NULL UNIQUE REFERENCES bon.chauffeurs(id) ON DELETE CASCADE,
  numero               text,
  expiration           date,
  dernier_telechargement date,   -- données déchargées le…
  scan_recto           text,
  scan_verso           text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- CACES (plusieurs par chauffeur) --------------------------------------------
CREATE TABLE IF NOT EXISTS bon.caces (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chauffeur_id bigint NOT NULL REFERENCES bon.chauffeurs(id) ON DELETE CASCADE,
  type         text NOT NULL,     -- R490, R482...
  categories   text[] NOT NULL DEFAULT '{}'::text[],
  expiration   date,
  scan_recto   text,
  scan_verso   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS : BUREAU uniquement (un chauffeur ne voit PAS ces documents, même les siens).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['permis','permis_categories','fco','carte_conducteur','caces']) LOOP
    EXECUTE format('ALTER TABLE bon.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON bon.%I TO authenticated;', t);
    EXECUTE format('GRANT SELECT ON bon.%I TO service_role;', t);
    EXECUTE format(
      'CREATE POLICY %1$s_bureau ON bon.%1$s FOR ALL TO authenticated '
      'USING (bon.is_bureau()) WITH CHECK (bon.is_bureau());', t);
  END LOOP;
END $$;

-- Vues API (security_invoker => RLS bureau s'applique).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['permis','permis_categories','fco','carte_conducteur','caces']) LOOP
    EXECUTE format(
      'CREATE OR REPLACE VIEW api.%1$I WITH (security_invoker = true) AS SELECT * FROM bon.%1$I;', t);
    EXECUTE format('ALTER VIEW api.%1$I OWNER TO postgres;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON api.%1$I TO authenticated;', t);
  END LOOP;
END $$;

-- Alertes documents : expirations proches/dépassées + retard de carte conducteur.
-- statut : 'expire' (échéance passée), 'bientot' (<= alerte_jours), 'retard' (carte).
CREATE OR REPLACE FUNCTION bon.alertes_documents()
  RETURNS TABLE (chauffeur_id bigint, chauffeur text, type_document text,
                 detail text, echeance date, jours_restants integer, statut text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bon, pg_temp AS $$
  WITH seuils AS (
    SELECT coalesce((SELECT valeur::int FROM bon.reglages WHERE cle='alerte_jours'), 60) AS alerte,
           coalesce((SELECT valeur::int FROM bon.reglages WHERE cle='carte_conducteur_retard_jours'), 28) AS retard
  ),
  docs AS (
    SELECT ch.id, ch.nom, 'Permis '||pc.categorie AS type_document, pc.categorie AS detail, pc.validite AS echeance
      FROM bon.chauffeurs ch JOIN bon.permis_categories pc ON pc.chauffeur_id = ch.id
     WHERE ch.date_sortie IS NULL
    UNION ALL
    SELECT ch.id, ch.nom, 'FCO / code 95', f.numero, f.expiration
      FROM bon.chauffeurs ch JOIN bon.fco f ON f.chauffeur_id = ch.id WHERE ch.date_sortie IS NULL
    UNION ALL
    SELECT ch.id, ch.nom, 'Carte conducteur', cc.numero, cc.expiration
      FROM bon.chauffeurs ch JOIN bon.carte_conducteur cc ON cc.chauffeur_id = ch.id WHERE ch.date_sortie IS NULL
    UNION ALL
    SELECT ch.id, ch.nom, 'CACES '||c.type, array_to_string(c.categories, ', '), c.expiration
      FROM bon.chauffeurs ch JOIN bon.caces c ON c.chauffeur_id = ch.id WHERE ch.date_sortie IS NULL
  )
  SELECT d.id, d.nom, d.type_document, d.detail, d.echeance,
         (d.echeance - CURRENT_DATE) AS jours_restants,
         CASE WHEN d.echeance < CURRENT_DATE THEN 'expire'
              WHEN d.echeance <= CURRENT_DATE + (SELECT alerte FROM seuils) THEN 'bientot'
              ELSE 'ok' END AS statut
    FROM docs d
   WHERE d.echeance IS NOT NULL
     AND d.echeance <= CURRENT_DATE + (SELECT alerte FROM seuils)
  UNION ALL
  -- Retard de téléchargement de la carte conducteur (> retard jours).
  SELECT ch.id, ch.nom, 'Carte conducteur', 'dernier téléchargement',
         cc.dernier_telechargement,
         (CURRENT_DATE - cc.dernier_telechargement) * -1,
         'retard'
    FROM bon.chauffeurs ch JOIN bon.carte_conducteur cc ON cc.chauffeur_id = ch.id
   WHERE ch.date_sortie IS NULL AND cc.dernier_telechargement IS NOT NULL
     AND cc.dernier_telechargement < CURRENT_DATE - (SELECT retard FROM seuils)
$$;

-- Exposée au BUREAU uniquement (renvoie vide sinon).
CREATE OR REPLACE FUNCTION api.alertes_documents()
  RETURNS TABLE (chauffeur_id bigint, chauffeur text, type_document text,
                 detail text, echeance date, jours_restants integer, statut text)
  LANGUAGE sql STABLE AS $$
  SELECT * FROM bon.alertes_documents() WHERE bon.is_bureau()
$$;
GRANT EXECUTE ON FUNCTION bon.alertes_documents(), api.alertes_documents()
  TO authenticated, service_role;
-- bon_worker (créé en 0008) appelle ces fonctions via /worker/alertes.
GRANT EXECUTE ON FUNCTION bon.alertes_documents() TO bon_worker;

-- Purge des scans au départ d'un salarié (date_sortie renseignée). Renvoie les
-- clés d'objets à supprimer côté Storage (le worker s'en charge).
CREATE OR REPLACE FUNCTION bon.purge_documents_chauffeur(p_chauffeur_id bigint)
  RETURNS text[]
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE v_keys text[];
BEGIN
  SELECT array_remove(array_agg(k), NULL) INTO v_keys FROM (
    SELECT scan_recto k FROM bon.permis WHERE chauffeur_id = p_chauffeur_id
    UNION ALL SELECT scan_verso FROM bon.permis WHERE chauffeur_id = p_chauffeur_id
    UNION ALL SELECT scan_recto FROM bon.fco WHERE chauffeur_id = p_chauffeur_id
    UNION ALL SELECT scan_verso FROM bon.fco WHERE chauffeur_id = p_chauffeur_id
    UNION ALL SELECT scan_recto FROM bon.carte_conducteur WHERE chauffeur_id = p_chauffeur_id
    UNION ALL SELECT scan_verso FROM bon.carte_conducteur WHERE chauffeur_id = p_chauffeur_id
    UNION ALL SELECT scan_recto FROM bon.caces WHERE chauffeur_id = p_chauffeur_id
    UNION ALL SELECT scan_verso FROM bon.caces WHERE chauffeur_id = p_chauffeur_id
  ) s;
  UPDATE bon.permis           SET scan_recto=NULL, scan_verso=NULL WHERE chauffeur_id=p_chauffeur_id;
  UPDATE bon.fco              SET scan_recto=NULL, scan_verso=NULL WHERE chauffeur_id=p_chauffeur_id;
  UPDATE bon.carte_conducteur SET scan_recto=NULL, scan_verso=NULL WHERE chauffeur_id=p_chauffeur_id;
  UPDATE bon.caces            SET scan_recto=NULL, scan_verso=NULL WHERE chauffeur_id=p_chauffeur_id;
  RETURN coalesce(v_keys, '{}'::text[]);
END $$;
GRANT EXECUTE ON FUNCTION bon.purge_documents_chauffeur(bigint) TO service_role, authenticated, bon_worker;
GRANT UPDATE ON bon.chauffeurs TO bon_worker;  -- date_sortie au départ

-- updated_at
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['permis','fco','carte_conducteur','caces']) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_touch ON bon.%1$I;'
      'CREATE TRIGGER trg_touch BEFORE UPDATE ON bon.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION bon.touch_updated_at();', t);
  END LOOP;
END $$;

-- Bucket Storage PRIVÉ + politiques BUREAU uniquement. Garde : seulement si le
-- schéma storage existe (présent sur supabase/postgres, absent en test SQL pur).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('chauffeur-docs', 'chauffeur-docs', false)
    ON CONFLICT (id) DO NOTHING;

    DROP POLICY IF EXISTS chauffeur_docs_bureau ON storage.objects;
    CREATE POLICY chauffeur_docs_bureau ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'chauffeur-docs' AND bon.is_bureau())
      WITH CHECK (bucket_id = 'chauffeur-docs' AND bon.is_bureau());
    GRANT EXECUTE ON FUNCTION bon.is_bureau() TO authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
