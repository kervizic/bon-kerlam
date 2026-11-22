-- down 0031 : retire la file de signature et la colonne d'état. La vue dépend de la
-- colonne : on la supprime d'abord, puis on la recrée SANS signature_job_state.
DROP VIEW IF EXISTS api.lettres_voiture;
ALTER TABLE bon.lettres_voiture DROP COLUMN IF EXISTS signature_job_state;
DROP TABLE IF EXISTS bon.signature_jobs;

CREATE VIEW api.lettres_voiture WITH (security_invoker = true) AS
  SELECT id, numero, date_etablissement, date_prise_en_charge, expediteur, destinataire,
         dest_identique, camion_id, chauffeur_id, projet_id, contact_id, heures_regie,
         statut, preparee, owner_email, deleted_at, created_at, updated_at,
         documenso_document_id, signature_mode, signed_pdf_path, signature_sent_at,
         heures, annulation_motif, annulation_categorie, annulee_at, annulee_par,
         deleted_par, client_id, destinataire_client_id, quantite_estimee,
         quantite_estimee_unite, client_adresse_id, dest_adresse_id
    FROM bon.lettres_voiture;
ALTER VIEW api.lettres_voiture OWNER TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.lettres_voiture TO authenticated;
NOTIFY pgrst, 'reload schema';
