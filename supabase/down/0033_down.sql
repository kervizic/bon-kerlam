-- down 0033_beta35_photos_lignes : retire les photos par ligne (table, vue, RLS,
-- triggers, helpers, policies storage) et la file de purge storage.
-- ATTENTION : les métadonnées des photos sont perdues. Les objets du bucket
-- « photos-lignes » ne sont PAS supprimés ici (bucket conservé, inaccessible aux
-- clients une fois les policies retirées) ; vider la file bon.storage_purge
-- (worker /purge-corbeille) AVANT ce down si l'on veut éviter des orphelins.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    BEGIN
      DROP POLICY IF EXISTS photos_lignes_select ON storage.objects;
      DROP POLICY IF EXISTS photos_lignes_insert ON storage.objects;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Policies storage photos-lignes non retirées (%).', SQLERRM;
    END;
  END IF;
END $$;

DROP VIEW IF EXISTS api.ligne_photos;
DROP TABLE IF EXISTS bon.ligne_photos;
DROP FUNCTION IF EXISTS bon.trg_ligne_photos_check();
DROP FUNCTION IF EXISTS bon.trg_ligne_photos_purge();
DROP FUNCTION IF EXISTS bon.purge_photos_corbeille();
DROP FUNCTION IF EXISTS bon.photo_path_ok(text);
DROP FUNCTION IF EXISTS bon.photo_path_lv(text);
DROP TABLE IF EXISTS bon.storage_purge;

NOTIFY pgrst, 'reload schema';
