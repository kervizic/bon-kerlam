-- @migration:     0014_expediteur_client
-- @description:   (D) L'expéditeur n'est plus saisi : il est dérivé du CLIENT sur
--                 le PDF (raison sociale + adresse). On sauvegarde puis on neutralise
--                 l'ancien expéditeur « KERLAM » des lettres existantes (la valeur
--                 stockée n'est plus affichée). La table de sauvegarde sert de liste
--                 des lettres touchées.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP TABLE IF EXISTS bon.lv_expediteur_backup;

CREATE TABLE IF NOT EXISTS bon.lv_expediteur_backup (
  id          bigint,
  numero      text,
  expediteur  text,
  destinataire text,
  dest_identique boolean,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bon.lv_expediteur_backup (id, numero, expediteur, destinataire, dest_identique)
SELECT id, numero, expediteur, destinataire, dest_identique
  FROM bon.lettres_voiture
 WHERE expediteur = 'KERLAM'
   AND id NOT IN (SELECT id FROM bon.lv_expediteur_backup);

UPDATE bon.lettres_voiture
   SET expediteur = NULL
 WHERE expediteur = 'KERLAM';

NOTIFY pgrst, 'reload schema';
