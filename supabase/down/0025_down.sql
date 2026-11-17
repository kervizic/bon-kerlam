-- down 0025_lv_pdf_cache : supprime la table de cache (reconstructible, aucune
-- donnée métier perdue).
DROP TABLE IF EXISTS bon.lv_pdf_cache;
