-- @migration:     0013_signature
-- @description:   Suivi de la signature électronique (Documenso) sur les lettres
--                 de voiture : identifiant de document/enveloppe Documenso, mode
--                 de signature (sur place | par mail), chemin du PDF signé archivé.
--                 Colonnes de bookkeeping côté worker uniquement (bon_worker a
--                 BYPASSRLS + UPDATE sur bon.lettres_voiture) : non exposées au
--                 front, qui ne lit que le statut.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          ALTER TABLE bon.lettres_voiture
--                   DROP COLUMN IF EXISTS documenso_document_id,
--                   DROP COLUMN IF EXISTS signature_mode,
--                   DROP COLUMN IF EXISTS signed_pdf_path,
--                   DROP COLUMN IF EXISTS signature_sent_at;

ALTER TABLE bon.lettres_voiture
  ADD COLUMN IF NOT EXISTS documenso_document_id bigint,
  ADD COLUMN IF NOT EXISTS signature_mode        text,  -- 'sur_place' | 'par_mail'
  ADD COLUMN IF NOT EXISTS signed_pdf_path       text,
  ADD COLUMN IF NOT EXISTS signature_sent_at     timestamptz;

CREATE INDEX IF NOT EXISTS lv_documenso_idx
  ON bon.lettres_voiture (documenso_document_id)
  WHERE documenso_document_id IS NOT NULL;

-- Lettres en attente de retour de signature (statut 'envoyee' = en attente),
-- pour le polling du worker.
CREATE INDEX IF NOT EXISTS lv_attente_signature_idx
  ON bon.lettres_voiture (statut)
  WHERE statut = 'envoyee' AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
