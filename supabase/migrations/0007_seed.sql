-- @migration:     0007_seed
-- @description:   Données de départ publiques : articles KERLAM + sites communs
--                 YPREMA. lat/lon laissés NULL : géocodés via la BAN au premier
--                 démarrage du worker. Idempotent.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DELETE FROM bon.articles ; DELETE FROM bon.sites WHERE portee='commun';

-- Articles (nom imprimé | commentaire interne jamais imprimé) -----------------
INSERT INTO bon.articles (nom, commentaire_interne, unites, created_by)
SELECT v.nom, v.com, ARRAY['t','m3','unite']::text[], 'seed'
FROM (VALUES
  ('Grave', 'recyclée 0/31,5 · 0/70 · concassée industrielle 0/31,5 · béton concassé 0/20 · 0/31,5 · cailloux 30/70 · 0/63 · industrielle VRD 0/31,5, 3 % liant'),
  ('URBASOL terres traitées à la chaux', NULL),
  ('Sable', 'recyclé 0/6 · silico-calcaire 0/4 · sablon'),
  ('Gravillon', 'recyclé 4/20 · silico-calcaire 5/25, roulé ou concassé'),
  ('Gravats', NULL),
  ('Béton de démolition', '170101 · non ferraillé · ferraillé · fortement ferraillé'),
  ('Couches de chaussée', '170302 · prêtes à concasser · à cribler'),
  ('Déconstructions inertes', '170302 · tuiles, briques, céramique, pavés, pierres'),
  ('Terres inertes', '170504')
) AS v(nom, com)
WHERE NOT EXISTS (SELECT 1 FROM bon.articles a WHERE a.nom = v.nom);

-- Sites communs YPREMA (lun-ven 6h-17h30 sauf mention) -----------------------
INSERT INTO bon.sites (nom, adresse, type, portee, statut, created_by)
SELECT v.nom, v.adresse, v.type, 'commun', 'actif', 'seed'
FROM (VALUES
  ('YPREMA Lagny',         '6 rue Freycinet, Port de Lagny, 77400 Lagny-sur-Marne', 'transit et recyclage de terres'),
  ('YPREMA Émerainville',  '11 allée de la Briarde, 77184 Émerainville',            'centrale de recyclage'),
  ('Yterres Émerainville', '11 allée de la Briarde, 77184 Émerainville',            'transit et recyclage de terres (7h-18h30)'),
  ('YPREMA Bonneuil',      '63-64 route de l''Île St Julien, Port de Bonneuil, 94380 Bonneuil-sur-Marne', 'point de vente'),
  ('YPREMA Massy',         '11 route de la Bonde, ZI de la Bonde, 91300 Massy',     'plateforme'),
  ('YPREMA Trappes',       'Allée Basile Levraud, 78190 Trappes',                   'plateforme'),
  ('YPREMA Gennevilliers', '7 route du Môle Central, Port de Gennevilliers, 92230 Gennevilliers', 'plateforme')
) AS v(nom, adresse, type)
WHERE NOT EXISTS (SELECT 1 FROM bon.sites s WHERE s.nom = v.nom AND s.portee = 'commun');
