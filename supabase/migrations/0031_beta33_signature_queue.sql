-- @migration:     0031_beta33_signature_queue
-- @description:   (beta.33) Signature SUR PLACE sans page embed Documenso, en ordre
--                 inversé : RIEN n'est créé côté Documenso tant que le client n'a pas
--                 validé son dessin. Table de file PERSISTANTE (rejouable après
--                 redémarrage) bon.signature_jobs : le worker crée le document, pose
--                 la signature (PNG) via tRPC, complète, archive, marque « signee »,
--                 en tâche de fond. Colonne lettres_voiture.signature_job_state pour
--                 l'affichage chauffeur (recording / failed). Le trigger d'immuabilité
--                 des lettres SIGNÉES (0027) reste strictement inchangé.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0031_down.sql

-- État d'enregistrement de signature affiché sur la lettre (indépendant du statut) :
--   NULL        -> rien en cours
--   'recording' -> « Signée — enregistrement… » (sur place, en file/au travail)
--   'failed'    -> « Signature non enregistrée — à refaire » (bandeau rouge)
ALTER TABLE bon.lettres_voiture ADD COLUMN IF NOT EXISTS signature_job_state text;

-- File de signature SUR PLACE (persistante, rejouable). Une ligne par lot validé.
CREATE TABLE IF NOT EXISTS bon.signature_jobs (
  id             bigserial PRIMARY KEY,
  lv_ids         bigint[] NOT NULL,
  signer_name    text,
  signer_email   text NOT NULL,
  signature_png  text NOT NULL,          -- data URL PNG du dessin client
  status         text NOT NULL DEFAULT 'pending',  -- pending/processing/done/failed
  attempts       integer NOT NULL DEFAULT 0,
  document_id    bigint,                 -- id Documenso, dès qu'il est créé
  png_path       text,                   -- clé storage du PNG conservé (diagnostic 30 j)
  last_error     text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signature_jobs_pending_idx
  ON bon.signature_jobs (next_attempt_at)
  WHERE status IN ('pending', 'processing');

GRANT SELECT, INSERT, UPDATE, DELETE ON bon.signature_jobs TO bon_worker;
GRANT USAGE, SELECT ON SEQUENCE bon.signature_jobs_id_seq TO bon_worker;

-- Vue API : recrée api.lettres_voiture pour exposer signature_job_state au front.
-- CREATE OR REPLACE VIEW n'autorise que l'AJOUT de colonnes EN FIN de liste (pas
-- d'insertion au milieu) : signature_job_state est donc placée en dernier.
CREATE OR REPLACE VIEW api.lettres_voiture WITH (security_invoker = true) AS
  SELECT id, numero, date_etablissement, date_prise_en_charge, expediteur, destinataire,
         dest_identique, camion_id, chauffeur_id, projet_id, contact_id, heures_regie,
         statut, preparee, owner_email, deleted_at, created_at, updated_at,
         documenso_document_id, signature_mode, signed_pdf_path, signature_sent_at,
         heures, annulation_motif, annulation_categorie, annulee_at, annulee_par,
         deleted_par, client_id, destinataire_client_id, quantite_estimee,
         quantite_estimee_unite, client_adresse_id, dest_adresse_id,
         signature_job_state
    FROM bon.lettres_voiture;

ALTER VIEW api.lettres_voiture OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.lettres_voiture TO authenticated;

NOTIFY pgrst, 'reload schema';
