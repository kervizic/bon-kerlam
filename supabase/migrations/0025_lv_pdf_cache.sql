-- @migration:     0025_lv_pdf_cache
-- @description:   (beta.25) Table de CACHE du PDF rendu de chaque lettre + les
--                 positions mesurées de ses ancres de signature. Sert à préparer
--                 la signature de façon quasi instantanée : au moment de signer, on
--                 ne refait PLUS le rendu WeasyPrint (lent : sous-typage de police),
--                 on fusionne seulement les PDF déjà en cache. Clé = hash du contenu
--                 de la lettre -> le cache s'invalide tout seul si la lettre change.
--                 Aucune donnée métier : purement du cache, reconstructible.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0025_down.sql

CREATE TABLE IF NOT EXISTS bon.lv_pdf_cache (
  lv_id        bigint PRIMARY KEY REFERENCES bon.lettres_voiture(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  pdf          bytea NOT NULL,
  anchors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  n_pages      integer NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Le worker (bon_worker) lit et écrit ce cache.
GRANT SELECT, INSERT, UPDATE, DELETE ON bon.lv_pdf_cache TO bon_worker;
