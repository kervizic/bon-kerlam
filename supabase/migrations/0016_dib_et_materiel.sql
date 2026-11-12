-- @migration:     0016_dib_et_materiel
-- @description:   Catalogue commun : ajout de l'article « DIB (déchets industriels
--                 banals) ». Parc : désactivation (actif=false, jamais supprimé)
--                 du matériel « 20 t 8×4 bi-benne » (SANS grue) ; les 4 autres
--                 restent actifs. Additive et idempotente.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DELETE FROM bon.articles WHERE nom='DIB (déchets industriels banals)';
--                 UPDATE bon.materiels SET actif=true WHERE libelle='20 t 8×4 bi-benne';

-- Article commun « DIB » (seed idempotent, même forme que 0007) ----------------
INSERT INTO bon.articles (nom, commentaire_interne, unites, created_by)
SELECT v.nom, v.com, ARRAY['t','m3','unite']::text[], 'seed'
FROM (VALUES
  ('DIB (déchets industriels banals)', NULL)
) AS v(nom, com)
WHERE NOT EXISTS (SELECT 1 FROM bon.articles a WHERE a.nom = v.nom);

-- Désactivation du « 20 t 8×4 bi-benne » SANS grue (conservé pour l'historique,
-- jamais supprimé). Idempotent : l'UPDATE se contente de remettre actif=false.
UPDATE bon.materiels
   SET actif = false
 WHERE libelle = '20 t 8×4 bi-benne'
   AND actif IS DISTINCT FROM false;

-- PostgREST : recharge du cache de schéma.
NOTIFY pgrst, 'reload schema';
