-- @migration:     0027_beta29_lv_signee_immuable
-- @description:   (beta.29) Une lettre SIGNÉE est immuable sur deux champs : son
--                 statut ne peut plus changer et sa référence Documenso
--                 (documenso_document_id) ne peut plus être modifiée. Dernière
--                 ligne de défense contre un renvoi en signature d'une lettre déjà
--                 signée (le front masque « Signer » et le worker renvoie 409 ;
--                 ce trigger garantit l'intégrité même en cas de contournement).
--                 Les autres colonnes (signed_pdf_path pour l'archivage,
--                 deleted_at) restent modifiables.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0027_down.sql

CREATE OR REPLACE FUNCTION bon.trg_lv_signee_immuable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.statut = 'signee' THEN
    IF NEW.statut IS DISTINCT FROM OLD.statut THEN
      RAISE EXCEPTION 'Lettre % déjà signée : statut non modifiable.', COALESCE(OLD.numero, OLD.id::text)
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.documenso_document_id IS DISTINCT FROM OLD.documenso_document_id THEN
      RAISE EXCEPTION 'Lettre % déjà signée : référence de signature non modifiable.', COALESCE(OLD.numero, OLD.id::text)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lv_signee_immuable ON bon.lettres_voiture;
CREATE TRIGGER trg_lv_signee_immuable BEFORE UPDATE ON bon.lettres_voiture
  FOR EACH ROW EXECUTE FUNCTION bon.trg_lv_signee_immuable();
