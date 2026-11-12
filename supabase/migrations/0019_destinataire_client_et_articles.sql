-- @migration:     0019_destinataire_client_et_articles
-- @description:   (beta.18) Destinataire distinct référencé comme un CLIENT
--                 (destinataire_client_id) : nom + adresse imprimés sur le PDF
--                 (adresse obligatoire — arrêté du 9/11/1999 art. 5). L'ancien
--                 champ texte `destinataire` reste en lecture (migration douce).
--                 Réconcilie aussi le catalogue d'articles avec l'état prod
--                 (« Béton de démolition » -> « Béton », « Engins » -> « Engin de
--                 chantier », + Enrobé / Matériel divers / Container) de façon
--                 idempotente, pour qu'un déploiement ne recrée PAS les anciens
--                 noms. NB : 0007_seed est déjà appliqué en prod et ne peut pas
--                 être réédité (apply.py refuse toute dérive de sha256) ; cette
--                 réconciliation vit donc dans une migration dédiée, idempotente,
--                 qui converge aussi une base vierge (0007 puis 0019) vers l'état
--                 canonique.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          ALTER TABLE bon.lettres_voiture DROP COLUMN IF EXISTS destinataire_client_id;

-- 1) Destinataire distinct = référence client -------------------------------
ALTER TABLE bon.lettres_voiture
  ADD COLUMN IF NOT EXISTS destinataire_client_id bigint
    REFERENCES bon.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lv_destinataire_client_idx
  ON bon.lettres_voiture (destinataire_client_id);

-- Reprise douce : les lettres dont le destinataire texte correspond EXACTEMENT à
-- la raison sociale d'un client existant héritent de la clé (aucune perte : le
-- texte reste en place). Les saisies libres sans correspondance sont conservées.
UPDATE bon.lettres_voiture lv
   SET destinataire_client_id = c.id
  FROM bon.clients c
 WHERE lv.dest_identique = false
   AND lv.destinataire_client_id IS NULL
   AND lv.destinataire IS NOT NULL
   AND c.raison_sociale = lv.destinataire;

-- Vue API rafraîchie (nouvelle colonne exposée au front via SELECT *).
CREATE OR REPLACE VIEW api.lettres_voiture WITH (security_invoker = true) AS
  SELECT * FROM bon.lettres_voiture;

-- 2) Réconciliation du catalogue d'articles (idempotente) -------------------
-- Renommages : uniquement si le nom cible n'existe pas déjà (évite un doublon et
-- préserve l'id -> les tour_lignes restent rattachées).
UPDATE bon.articles a
   SET nom = 'Béton'
 WHERE a.nom = 'Béton de démolition'
   AND NOT EXISTS (SELECT 1 FROM bon.articles b WHERE b.nom = 'Béton');

UPDATE bon.articles a
   SET nom = 'Engin de chantier'
 WHERE a.nom = 'Engins'
   AND NOT EXISTS (SELECT 1 FROM bon.articles b WHERE b.nom = 'Engin de chantier');

-- Ajouts présents en prod (idempotents) : une base vierge converge vers l'état réel.
INSERT INTO bon.articles (nom, unites, created_by)
SELECT v.nom, ARRAY['t','m3','unite']::text[], 'seed'
FROM (VALUES ('Enrobé'), ('Matériel divers'), ('Container')) AS v(nom)
WHERE NOT EXISTS (SELECT 1 FROM bon.articles a WHERE a.nom = v.nom);

NOTIFY pgrst, 'reload schema';
