-- Retour arrière de 0024_noms_groupes_veolia_syneos (testé par supabase/tests).
-- Restaure raison sociale + alias d'origine depuis bon.beta223_noms_backup.

UPDATE bon.clients c
   SET raison_sociale = b.raison_sociale, alias = b.alias
  FROM bon.beta223_noms_backup b
 WHERE c.id = b.client_id;

INSERT INTO bon.aliases (cible_type, cible_id, alias, origine)
SELECT 'client', b.client_id, x->>'alias', x->>'origine'
  FROM bon.beta223_noms_backup b, jsonb_array_elements(b.aliases_json) x
 WHERE COALESCE(x->>'alias', '') <> ''
ON CONFLICT (cible_type, cible_id, lower(alias)) DO NOTHING;

DROP TABLE IF EXISTS bon.beta223_noms_backup;

NOTIFY pgrst, 'reload schema';
