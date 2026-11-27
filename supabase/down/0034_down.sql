-- down 0034_beta36_documents_chauffeur : retire « Mes documents » (table, vue, RPC
-- admin, RLS, triggers, helpers, policies storage) et le garde-fou du rôle admin.
-- ATTENTION : les métadonnées des documents sont perdues. Les objets du bucket
-- « documents-chauffeurs » ne sont PAS supprimés ici (bucket conservé, inaccessible
-- aux clients une fois les policies retirées) : pour éviter des orphelins, supprimer
-- d'abord les documents (DELETE FROM bon.documents_chauffeur => file de purge) puis
-- laisser le worker vider bon.storage_purge AVANT ce down.
-- La valeur 'admin' éventuellement présente dans bon.utilisateurs.roles est
-- conservée (sans effet une fois bon.is_admin() retirée).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    BEGIN
      DROP POLICY IF EXISTS documents_chauffeurs_select ON storage.objects;
      DROP POLICY IF EXISTS documents_chauffeurs_insert ON storage.objects;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Policies storage documents-chauffeurs non retirées (%).', SQLERRM;
    END;
  END IF;
END $$;

DROP FUNCTION IF EXISTS api.documents_proprietaires();
DROP VIEW IF EXISTS api.documents_chauffeur;
DROP TABLE IF EXISTS bon.documents_chauffeur;
DROP FUNCTION IF EXISTS bon.trg_documents_chauffeur_check();
DROP FUNCTION IF EXISTS bon.trg_documents_chauffeur_purge();
DROP FUNCTION IF EXISTS bon.doc_chauffeur_path_ok(text, bigint, uuid);
DROP FUNCTION IF EXISTS bon.doc_chauffeur_path_owner(text);
DROP FUNCTION IF EXISTS bon.doc_chauffeur_objects(text);
DROP TRIGGER IF EXISTS trg_zz_admin_guard ON bon.utilisateurs;
DROP FUNCTION IF EXISTS bon.trg_utilisateurs_admin_guard();
DROP FUNCTION IF EXISTS bon.my_user_id();
DROP FUNCTION IF EXISTS bon.is_admin();

NOTIFY pgrst, 'reload schema';
