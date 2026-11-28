-- @migration:     0035_beta361_retrait_documents_bureau
-- @description:   (beta.36.1) Retrait des documents réglementaires BUREAU de 0011
--                 (bon.permis, bon.permis_categories, bon.fco, bon.carte_conducteur,
--                 bon.caces + vues api, policies, triggers, bon/api.alertes_documents,
--                 bon.purge_documents_chauffeur, policy storage chauffeur_docs_bureau),
--                 jamais utilisés en prod (0 ligne, 0 fichier au 28/11/2026),
--                 remplacés par « Mes documents » (0034). GARDE-FOU : la migration
--                 échoue si une de ces tables contient une ligne (rien n'est perdu).
--                 CONSERVÉS : bucket « chauffeur-docs » (PNG de diagnostic des
--                 signatures en échec, accès service_role uniquement),
--                 bon.chauffeurs.date_sortie (départ d'un salarié), réglages,
--                 GRANT UPDATE bon.chauffeurs à bon_worker.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0035_down.sql (recrée les objets de 0011 à l'identique)

DO $$
DECLARE t text; n bigint;
BEGIN
  FOR t IN SELECT unnest(ARRAY['permis','permis_categories','fco','carte_conducteur','caces']) LOOP
    IF to_regclass('bon.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM bon.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'bon.% contient % ligne(s) : retrait annulé (migrer d''abord vers bon.documents_chauffeur).', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS api.alertes_documents();
DROP FUNCTION IF EXISTS bon.alertes_documents();
DROP FUNCTION IF EXISTS bon.purge_documents_chauffeur(bigint);

DROP VIEW IF EXISTS api.permis_categories;
DROP VIEW IF EXISTS api.permis;
DROP VIEW IF EXISTS api.fco;
DROP VIEW IF EXISTS api.carte_conducteur;
DROP VIEW IF EXISTS api.caces;

-- Les policies RLS et triggers trg_touch disparaissent avec leurs tables.
DROP TABLE IF EXISTS bon.permis_categories;
DROP TABLE IF EXISTS bon.permis;
DROP TABLE IF EXISTS bon.fco;
DROP TABLE IF EXISTS bon.carte_conducteur;
DROP TABLE IF EXISTS bon.caces;

-- Policy storage bureau sur « chauffeur-docs » : plus aucun usage client (le bucket
-- ne contient plus que les PNG de diagnostic du worker, lus en service_role).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    BEGIN
      DROP POLICY IF EXISTS chauffeur_docs_bureau ON storage.objects;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Policy storage chauffeur_docs_bureau non retirée (%).', SQLERRM;
    END;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
