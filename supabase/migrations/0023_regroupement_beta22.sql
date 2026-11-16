-- @migration:     0023_regroupement_beta22
-- @description:   (beta.22) Données : création des SOCIÉTÉS DE SITES (YPREMA,
--                 KERLAM, Veolia, Cemex, RFM, Asten, SPME, Sofrat), rattachement
--                 des sites existants, insertion des 32 nouveaux sites de
--                 chargement (coordonnées GPS), nommage exact des 2 sites Veolia,
--                 fusion du doublon Yterres -> YPREMA Émerainville, regroupements
--                 CLIENTS validés par Manu (Veolia : Épinay+Noisy ; Syneos :
--                 Gournay+Neuilly) et suppression de la fiche site vide « Nouveau
--                 site » si elle n'est référencée par aucun tour. Idempotente :
--                 clés naturelles (nom, siren), réexécution sans effet.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0023_down.sql (retour arrière testé ; la
--                 fiche vide « Nouveau site » supprimée n'est pas recréée).

-- =====================================================================
-- 1) Sociétés de sites (idempotent par nom)
-- =====================================================================
INSERT INTO bon.site_societes (nom, siren, created_by)
SELECT v.nom, v.siren, 'migration-0023'
  FROM (VALUES
    ('YPREMA', NULL),
    ('KERLAM', NULL),
    ('Veolia', '524334943'),
    ('Cemex',  NULL),               -- 2 SIREN distincts (BPE/Granulats) : volontairement non tranché
    ('RFM',    '478603228'),
    ('Asten',  '542057336'),
    ('SPME',   '662042753'),
    ('Sofrat', '332226083')
  ) AS v(nom, siren)
 WHERE NOT EXISTS (
   SELECT 1 FROM bon.site_societes s WHERE lower(s.nom) = lower(v.nom));

-- =====================================================================
-- 2) Rattachement des sites existants à leur société (par nom)
-- =====================================================================
UPDATE bon.sites s SET societe_id = ss.id
  FROM bon.site_societes ss
 WHERE ss.nom = 'YPREMA' AND s.societe_id IS NULL
   AND s.nom IN ('YPREMA Lagny','YPREMA Émerainville','YPREMA Bonneuil',
                 'YPREMA Massy','YPREMA Trappes','YPREMA Gennevilliers');

UPDATE bon.sites s SET societe_id = ss.id
  FROM bon.site_societes ss
 WHERE ss.nom = 'KERLAM' AND s.societe_id IS NULL AND s.nom = 'KERLAM Villevaudé';

-- =====================================================================
-- 3) Sites Veolia : nommage EXACT (2 adresses de chargement à Noisy-le-Grand)
-- =====================================================================
-- 3a) L'existant « usine des Terres » (2 rue de la Plaine) est renommé.
UPDATE bon.sites
   SET nom = 'Veolia - Usine des Terres'
 WHERE nom = 'Veolia Noisy-le-Grand (usine des Terres)';
UPDATE bon.sites s SET societe_id = ss.id
  FROM bon.site_societes ss
 WHERE ss.nom = 'Veolia' AND s.nom = 'Veolia - Usine des Terres' AND s.societe_id IS NULL;
-- ancien nom conservé comme alias de recherche
INSERT INTO bon.aliases (cible_type, cible_id, alias, origine)
SELECT 'site', s.id, 'Veolia Noisy-le-Grand (usine des Terres)', 'migration'
  FROM bon.sites s WHERE s.nom = 'Veolia - Usine des Terres'
ON CONFLICT (cible_type, cible_id, lower(alias)) DO NOTHING;

-- 3b) Nouvelle adresse « Veolia - Noisy » (6 rue de la Plaine). GPS NULL :
--     géocodé par la BAN au démarrage du worker (convention 0007).
INSERT INTO bon.sites (nom, adresse, type, portee, statut, created_by, societe_id)
SELECT 'Veolia - Noisy', '6 rue de la Plaine, 93160 Noisy-le-Grand',
       'dépôt matériaux', 'commun', 'actif', 'migration-0023',
       (SELECT id FROM bon.site_societes WHERE nom = 'Veolia')
 WHERE NOT EXISTS (SELECT 1 FROM bon.sites WHERE nom = 'Veolia - Noisy');

-- =====================================================================
-- 4) Insertion des 32 nouveaux sites de chargement (GPS fournis)
-- =====================================================================
INSERT INTO bon.sites (nom, adresse, lat, lon, type, portee, statut, created_by, societe_id)
SELECT v.nom, v.adresse, v.lat, v.lon, v.type, 'commun', 'actif', 'migration-0023',
       (SELECT id FROM bon.site_societes ss
         WHERE lower(ss.nom) = lower(v.soc) AND ss.merged_into_id IS NULL)
  FROM (VALUES
    -- Cemex (20)
    ('Cemex Nanterre','5 rue Lavoisier, 92000 Nanterre',48.895425,2.172728,'BPE','Cemex'),
    ('Cemex Gennevilliers port','2 route Principale du Port, 92230 Gennevilliers',48.940003,2.301719,'BPE','Cemex'),
    ('Cemex Gennevilliers bassin 6','Port de Gennevilliers route du Bassin n°6, 92230 Gennevilliers',48.947722,2.290728,'BPE','Cemex'),
    ('Cemex Saint-Denis port','Port St Denis Étoile 3 quai de Saint-Ouen, 93200 Saint-Denis',48.927607,2.338685,'granulats','Cemex'),
    ('Cemex Aubervilliers Landry','Port de Landry canal Saint-Denis, 93300 Aubervilliers',48.921587,2.371601,'granulats','Cemex'),
    ('Cemex Aubervilliers béton','29 quai Lucien Lefranc, 93300 Aubervilliers',48.909138,2.374875,'BPE','Cemex'),
    ('Cemex Bondy béton','5 quai Hubertine Auclert, 93140 Bondy',48.907041,2.477931,'BPE','Cemex'),
    ('Cemex Villeneuve-le-Roi','Rue des Vœux Saint-Georges, 94290 Villeneuve-le-Roi',48.731578,2.43321,'granulats','Cemex'),
    ('Cemex Ivry granulats','3 quai Marcel Boyer, 94200 Ivry-sur-Seine',48.82487,2.389281,'granulats','Cemex'),
    ('Cemex Ivry béton','Quai Marcel Boyer, 94200 Ivry-sur-Seine',48.823455,2.390874,'BPE','Cemex'),
    ('Cemex Congis','Chemin de l''Épine Blanche, 77440 Congis-sur-Thérouanne',49.000567,2.97745,'granulats','Cemex'),
    ('Cemex Changis','Chemin des Vieilles Noues, 77660 Changis-sur-Marne',48.973947,3.006777,'granulats','Cemex'),
    ('Cemex Pécy','Carrière, 77970 Pécy',48.658836,3.099678,'carrière','Cemex'),
    ('Cemex Villiers-sur-Seine','Lieu-dit Les Thurets, 77114 Villiers-sur-Seine',48.461204,3.382117,'granulats','Cemex'),
    ('Cemex Marolles-sur-Seine','Zone Industrielle, 77130 Marolles-sur-Seine',48.386662,3.07202,'granulats','Cemex'),
    ('Cemex Germigny-l''Évêque','Ferme de Rezel, 77910 Germigny-l''Évêque',48.99247,2.95969,'granulats','Cemex'),
    ('Cemex Le Mée-sur-Seine','ZAC Courtilleraies RN446 avenue de Corbeil, 77350 Le Mée-sur-Seine',48.539579,2.645153,'BPE','Cemex'),
    ('Cemex Isles-les-Villenoy','Chemin de l''Orme à l''Ânesse, 77450 Isles-les-Villenoy',48.914472,2.827045,'BPE','Cemex'),
    ('Cemex Mitry-Compans','ZAC de Mitry Compans rue Decauville, 77290 Mitry-Mory',48.985241,2.628688,'BPE','Cemex'),
    ('Cemex Pontault-Combault','ZA du Pré des Aulnes rue du Pré des Aulnes, 77340 Pontault-Combault',48.799451,2.628283,'BPE','Cemex'),
    -- RFM (7)
    ('RFM Bondy','Chemin de Halage, 93140 Bondy',48.889585,2.49613,'plateforme matériaux','RFM'),
    ('RFM Livry-Gargan','60 allée de l''Est, 93190 Livry-Gargan',48.932472,2.559781,'plateforme recyclage','RFM'),
    ('RFM Saint-Denis','120 rue Ambroise Croizat, 93200 Saint-Denis',48.927498,2.353801,'plateforme recyclage','RFM'),
    ('RFM Moissy-Cramayel','Avenue Blaise Pascal, 77550 Moissy-Cramayel',48.621664,2.567634,'plateforme recyclage','RFM'),
    ('RFM Roissy-en-Brie','3 impasse de la Lièvrerie, 77680 Roissy-en-Brie',48.789154,2.645523,'plateforme recyclage','RFM'),
    ('RFM Chennevières-sur-Marne','30 rue Gay-Lussac, 94430 Chennevières-sur-Marne',48.794941,2.542834,'plateforme recyclage','RFM'),
    ('RFM Vitry-sur-Seine','Avenue du Groupe Manouchian, 94400 Vitry-sur-Seine',48.791391,2.404095,'plateforme recyclage','RFM'),
    -- Asten (1)
    ('Asten Gennevilliers Môle Central','1 route du Môle Central, 92230 Gennevilliers',48.9401527,2.2863437,'centrale enrobés','Asten'),
    -- SPME (2)
    ('SPME Bonneuil','PORT AUTONOME DE BONNEUIL 7 route de l''Île Saint Julien, 94380 Bonneuil-sur-Marne',48.779468,2.489847,'centrale enrobés','SPME'),
    ('SPME Gennevilliers','13 route du Môle Central, 92230 Gennevilliers',48.944059,2.280797,'centrale enrobés','SPME'),
    -- Sofrat (2)
    ('Sofrat Ivry quai','51 quai Auguste Deshaies, 94200 Ivry-sur-Seine',48.818138,2.402602,'négoce matériaux','Sofrat'),
    ('Sofrat Annet','Lieu-dit La Fontaine Rouge CD 404, 77410 Annet-sur-Marne',48.914942,2.693112,'carrière / granulats','Sofrat')
  ) AS v(nom, adresse, lat, lon, type, soc)
 WHERE NOT EXISTS (SELECT 1 FROM bon.sites s WHERE s.nom = v.nom);

-- =====================================================================
-- 5) Fusion du doublon pur : Yterres Émerainville -> YPREMA Émerainville
--    (adresse et GPS identiques). Yterres devient un alias cherchable.
-- =====================================================================
DO $$
DECLARE v_garde bigint; v_yt bigint;
BEGIN
  SELECT id INTO v_garde FROM bon.sites
   WHERE nom = 'YPREMA Émerainville' AND merged_into_id IS NULL LIMIT 1;
  SELECT id INTO v_yt FROM bon.sites
   WHERE nom = 'Yterres Émerainville' AND merged_into_id IS NULL LIMIT 1;
  IF v_garde IS NOT NULL AND v_yt IS NOT NULL AND v_garde <> v_yt THEN
    PERFORM bon.fusionner_sites(v_garde, ARRAY[v_yt]);
  END IF;
END $$;

-- =====================================================================
-- 6) Regroupements CLIENTS validés par Manu (no-op si clients absents : CI/seed)
-- =====================================================================
DO $$
DECLARE v_g bigint; v_f bigint;
BEGIN
  -- Veolia : garde Épinay, fusionne Noisy (même SIREN 524334943).
  SELECT id INTO v_g FROM bon.clients
   WHERE siren = '524334943' AND adresse ILIKE '%Épinay%' AND merged_into_id IS NULL LIMIT 1;
  SELECT id INTO v_f FROM bon.clients
   WHERE siren = '524334943'
     AND (adresse ILIKE '%Noisy%' OR adresse ILIKE '%rue de la Plaine%')
     AND merged_into_id IS NULL LIMIT 1;
  IF v_g IS NOT NULL AND v_f IS NOT NULL AND v_g <> v_f THEN
    PERFORM bon.fusionner_clients(v_g, ARRAY[v_f]);
  END IF;

  -- Syneos : garde Gournay (708202833), fusionne Neuilly (340730787).
  SELECT id INTO v_g FROM bon.clients
   WHERE siren = '708202833' AND raison_sociale ILIKE 'Syneos%' AND merged_into_id IS NULL LIMIT 1;
  SELECT id INTO v_f FROM bon.clients
   WHERE siren = '340730787' AND raison_sociale ILIKE 'Syneos%' AND merged_into_id IS NULL LIMIT 1;
  IF v_g IS NOT NULL AND v_f IS NOT NULL AND v_g <> v_f THEN
    PERFORM bon.fusionner_clients(v_g, ARRAY[v_f]);
  END IF;
END $$;

-- Libellés d'adresses après regroupement (idempotent).
UPDATE bon.client_adresses ca SET libelle = 'Épinay'
  FROM bon.clients c
 WHERE ca.client_id = c.id AND c.siren = '524334943' AND c.merged_into_id IS NULL
   AND ca.adresse ILIKE '%Épinay%';
UPDATE bon.client_adresses ca SET libelle = 'Noisy'
  FROM bon.clients c
 WHERE ca.client_id = c.id AND c.siren = '524334943' AND c.merged_into_id IS NULL
   AND (ca.adresse ILIKE '%Noisy%' OR ca.adresse ILIKE '%rue de la Plaine%');
UPDATE bon.client_adresses ca SET libelle = 'Gournay'
  FROM bon.clients c
 WHERE ca.client_id = c.id AND c.raison_sociale ILIKE 'Syneos%' AND c.merged_into_id IS NULL
   AND ca.adresse ILIKE '%Gournay%';
UPDATE bon.client_adresses ca SET libelle = 'Neuilly'
  FROM bon.clients c
 WHERE ca.client_id = c.id AND c.raison_sociale ILIKE 'Syneos%' AND c.merged_into_id IS NULL
   AND ca.adresse ILIKE '%Neuilly%';

-- =====================================================================
-- 7) Suppression de la fiche site vide « Nouveau site » si NON référencée
-- =====================================================================
DELETE FROM bon.sites s
 WHERE s.nom = 'Nouveau site'
   AND COALESCE(s.adresse, '') = '' AND s.lat IS NULL AND s.lon IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM bon.tours t
      WHERE t.site_chargement_id = s.id OR t.site_dechargement_id = s.id);

NOTIFY pgrst, 'reload schema';
