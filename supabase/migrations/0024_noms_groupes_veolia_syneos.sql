-- @migration:     0024_noms_groupes_veolia_syneos
-- @description:   (beta.22.3) Nom AFFICHÉ = nom de GROUPE. La raison sociale des
--                 clients Veolia (SIREN 524334943) et Syneos (708202833 / 340730787)
--                 devient « Veolia » / « Syneos » ; les anciens noms d'établissement
--                 et leurs alias sont supprimés (base de TEST uniquement, aucun nom
--                 légal réel à préserver). SIREN et adresses conservés. AUCUNE
--                 lettre touchée. Migration de DONNÉES, idempotente, avec sauvegarde
--                 des lignes concernées (bon.beta223_noms_backup) et down.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0024_down.sql

-- Sauvegarde des lignes concernées (pour le retour arrière).
CREATE TABLE IF NOT EXISTS bon.beta223_noms_backup (
  client_id      bigint PRIMARY KEY,
  raison_sociale text,
  alias          text,
  aliases_json   jsonb,
  backed_up_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bon.beta223_noms_backup (client_id, raison_sociale, alias, aliases_json)
SELECT c.id, c.raison_sociale, c.alias,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('alias', a.alias, 'origine', a.origine))
                   FROM bon.aliases a WHERE a.cible_type = 'client' AND a.cible_id = c.id),
                '[]'::jsonb)
  FROM bon.clients c
 WHERE c.siren IN ('524334943', '708202833', '340730787')
   AND NOT EXISTS (SELECT 1 FROM bon.beta223_noms_backup b WHERE b.client_id = c.id);

-- Veolia (garde + établissement fusionné : même SIREN) -> « Veolia ».
UPDATE bon.clients SET raison_sociale = 'Veolia', alias = NULL
 WHERE siren = '524334943' AND raison_sociale <> 'Veolia';

-- Syneos (garde 708202833 + Neuilly 340730787) -> « Syneos ».
UPDATE bon.clients SET raison_sociale = 'Syneos', alias = NULL
 WHERE siren IN ('708202833', '340730787') AND raison_sociale <> 'Syneos';

-- Suppression des alias (anciens noms) de ces clients.
DELETE FROM bon.aliases
 WHERE cible_type = 'client'
   AND cible_id IN (SELECT id FROM bon.clients
                     WHERE siren IN ('524334943', '708202833', '340730787'));

NOTIFY pgrst, 'reload schema';
