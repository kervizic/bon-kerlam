-- @migration:     0030_beta32_cache_template_version
-- @description:   (beta.32) Sépare, dans le cache PDF, l'empreinte du CONTENU de la
--                 lettre de la version du GABARIT. Quand seul le gabarit change (après
--                 un déploiement de mise en page), le PDF existant reste valable : la
--                 signature l'utilise immédiatement et le re-rendu au nouveau gabarit
--                 se fait en arrière-plan. Évite le « cache 100 % froid » bloquant au
--                 déploiement. Colonne nullable : les lignes existantes seront
--                 rafraîchies au premier accès.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          voir supabase/down/0030_down.sql

ALTER TABLE bon.lv_pdf_cache ADD COLUMN IF NOT EXISTS template_version text;
