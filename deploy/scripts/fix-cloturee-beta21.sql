-- fix-cloturee-beta21.sql — correction des données du bug « Clôturée » (beta.21).
--
-- Contexte : avant beta.21, la clôture automatique de minuit du worker passait en
-- 'cloturee' TOUTES les lettres de la veille encore ouvertes — y compris les
-- brouillons (sans numéro) et les lettres numérotées non signées — faisant
-- apparaître un badge « Clôturée » trompeur. L'auto-clôture est neutralisée dans
-- beta.21 ; ce script remet les lettres concernées dans leur état réel ('en_cours',
-- l'état d'origine d'après l'audit) sans toucher aux lettres signées/annulées/
-- facturées. IDEMPOTENT : après exécution, plus aucune ligne 'cloturee' ne reste,
-- et un second passage est un no-op.
--
-- Exécution (après déploiement du worker beta.21, sinon re-clôture la nuit suivante) :
--   docker exec -i bon-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < deploy/scripts/fix-cloturee-beta21.sql
--
-- Une SAUVEGARDE des lignes touchées est écrite dans bon.lv_cloturee_backup_beta21
-- (restauration : UPDATE … SET statut = b.statut_avant FROM la table de sauvegarde).

BEGIN;

-- 1) Liste exacte des lignes concernées (traçabilité dans la sortie psql).
\echo 'Lignes statut=cloturee AVANT correction :'
SELECT id, numero, statut, date_etablissement, owner_email, updated_at
  FROM bon.lettres_voiture
 WHERE statut = 'cloturee'
 ORDER BY updated_at;

-- 2) Sauvegarde AVANT modification (idempotente : on n'écrase pas une sauvegarde
--    déjà prise pour un id).
CREATE TABLE IF NOT EXISTS bon.lv_cloturee_backup_beta21 (
  id                 bigint PRIMARY KEY,
  numero             text,
  statut_avant       text NOT NULL,
  date_etablissement date,
  owner_email        text,
  updated_at_avant   timestamptz,
  ligne              jsonb NOT NULL,
  sauvegarde_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bon.lv_cloturee_backup_beta21
      (id, numero, statut_avant, date_etablissement, owner_email, updated_at_avant, ligne)
SELECT lv.id, lv.numero, lv.statut::text, lv.date_etablissement, lv.owner_email,
       lv.updated_at, to_jsonb(lv)
  FROM bon.lettres_voiture lv
 WHERE lv.statut = 'cloturee'
ON CONFLICT (id) DO NOTHING;

-- 3) Correction : 'cloturee' -> 'en_cours' (état d'origine). On ne touche QUE les
--    'cloturee' ; jamais une lettre signée / annulée / facturée.
UPDATE bon.lettres_voiture
   SET statut = 'en_cours'
 WHERE statut = 'cloturee';

\echo 'Lignes restantes statut=cloturee APRÈS correction (doit être 0) :'
SELECT count(*) AS reste_cloturee FROM bon.lettres_voiture WHERE statut = 'cloturee';

COMMIT;
