-- @migration:     0018_client_direct_alias
-- @description:   Le CLIENT est désormais référencé directement sur la lettre de
--                 voiture (colonne client_id) ; le PROJET devient facultatif et
--                 filtré par client. Alias de recherche sur les clients (jamais
--                 affiché comme raison sociale). Création des référentiels
--                 (client/projet/contact/site) ouverte aux chauffeurs ; la
--                 modification reste réservée au bureau ou au créateur de la fiche.
--                 Vues API et fonctions (prefill, sites_pour) rafraîchies.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          ALTER TABLE bon.lettres_voiture DROP COLUMN IF EXISTS client_id;
--                 ALTER TABLE bon.clients DROP COLUMN IF EXISTS alias;
--                 ALTER TABLE bon.clients  DROP COLUMN IF EXISTS created_by;
--                 ALTER TABLE bon.projets  DROP COLUMN IF EXISTS created_by;
--                 ALTER TABLE bon.contacts DROP COLUMN IF EXISTS created_by;

-- 1) Alias de recherche sur les clients --------------------------------------
-- Recherche uniquement : la raison sociale officielle n'est jamais renommée.
ALTER TABLE bon.clients ADD COLUMN IF NOT EXISTS alias text;

-- Remplissage des alias connus (idempotent : seulement si vide).
UPDATE bon.clients SET alias = 'Jean Lefebvre'
 WHERE (alias IS NULL OR alias = '') AND raison_sociale ILIKE 'EJL%';
UPDATE bon.clients SET alias = 'SVTP'
 WHERE (alias IS NULL OR alias = '')
   AND raison_sociale ILIKE '%voirie%travaux%public%';
UPDATE bon.clients SET alias = 'Gleizon'
 WHERE (alias IS NULL OR alias = '') AND raison_sociale ILIKE 'Gleizon%';
UPDATE bon.clients SET alias = 'Watelet'
 WHERE (alias IS NULL OR alias = '') AND raison_sociale ILIKE 'Watelet%';
UPDATE bon.clients SET alias = 'Syneos'
 WHERE (alias IS NULL OR alias = '') AND raison_sociale ILIKE 'Syneos%';
UPDATE bon.clients SET alias = 'Veolia'
 WHERE (alias IS NULL OR alias = '') AND raison_sociale ILIKE 'Veolia%';

-- 2) Traçabilité du créateur (droit de modification des fiches) ---------------
-- Par défaut, l'acteur courant (via le JWT) ; NULL pour les lignes existantes
-- (seul le bureau pourra alors les modifier).
ALTER TABLE bon.clients  ADD COLUMN IF NOT EXISTS created_by text DEFAULT bon.current_actor();
ALTER TABLE bon.projets  ADD COLUMN IF NOT EXISTS created_by text DEFAULT bon.current_actor();
ALTER TABLE bon.contacts ADD COLUMN IF NOT EXISTS created_by text DEFAULT bon.current_actor();
-- bon.sites.created_by existe déjà : même défaut pour homogénéité.
ALTER TABLE bon.sites ALTER COLUMN created_by SET DEFAULT bon.current_actor();

-- 3) Client direct sur la lettre de voiture ----------------------------------
ALTER TABLE bon.lettres_voiture
  ADD COLUMN IF NOT EXISTS client_id bigint REFERENCES bon.clients(id) ON DELETE SET NULL;

-- Reprise : les lettres existantes héritent du client de leur projet.
UPDATE bon.lettres_voiture lv
   SET client_id = p.client_id
  FROM bon.projets p
 WHERE lv.projet_id = p.id AND lv.client_id IS NULL;

CREATE INDEX IF NOT EXISTS lv_client_idx ON bon.lettres_voiture (client_id);

-- 4) RLS : création des référentiels ouverte aux membres ; modification au
--    bureau OU au créateur de la fiche (un chauffeur ne touche pas celle d'un
--    autre). Suppression réservée au bureau.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['clients','contacts','projets']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON bon.%1$s;', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_insert ON bon.%1$s FOR INSERT TO authenticated
        WITH CHECK (bon.is_member());
      CREATE POLICY %1$s_update ON bon.%1$s FOR UPDATE TO authenticated
        USING (bon.is_bureau()
          OR (bon.is_chauffeur()
              AND lower(coalesce(created_by,'')) = lower(coalesce(bon.current_actor(),''))))
        WITH CHECK (bon.is_bureau()
          OR (bon.is_chauffeur()
              AND lower(coalesce(created_by,'')) = lower(coalesce(bon.current_actor(),''))));
      CREATE POLICY %1$s_delete ON bon.%1$s FOR DELETE TO authenticated
        USING (bon.is_bureau());
    $f$, t);
  END LOOP;
END $$;

-- Sites : le chauffeur peut déjà créer un chantier ; il peut maintenant modifier
-- les sites qu'il a lui-même créés (le bureau modifie tout).
DROP POLICY IF EXISTS sites_update ON bon.sites;
CREATE POLICY sites_update ON bon.sites FOR UPDATE TO authenticated
  USING (bon.is_bureau()
    OR (bon.is_chauffeur()
        AND lower(coalesce(created_by,'')) = lower(coalesce(bon.current_actor(),''))))
  WITH CHECK (bon.is_bureau()
    OR (bon.is_chauffeur()
        AND lower(coalesce(created_by,'')) = lower(coalesce(bon.current_actor(),''))));

-- 5) Vues API rafraîchies (nouvelles colonnes exposées via SELECT *) ----------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['clients','contacts','projets','lettres_voiture']) LOOP
    EXECUTE format(
      'CREATE OR REPLACE VIEW api.%1$I WITH (security_invoker = true) AS '
      'SELECT * FROM bon.%1$I;', t);
  END LOOP;
END $$;

-- 6) Pré-remplissage : exposer aussi le client mémorisé ----------------------
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
      'client_id', v_prep.client_id,
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
    'client_id', v_last.client_id,
    'projet_id', v_last.projet_id,
    'contact_id', v_last.contact_id);
END $$;

-- 7) Liste des sites : le client provient d'abord de la lettre, sinon du projet.
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
      LEFT JOIN bon.projets p ON p.id = lv.projet_id
     WHERE lv.chauffeur_id = p_chauffeur_id
       AND COALESCE(lv.client_id, p.client_id) = p_client_id
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

NOTIFY pgrst, 'reload schema';
