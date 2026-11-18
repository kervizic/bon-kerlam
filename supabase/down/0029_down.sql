-- down 0029_beta31_pdf_refresh_queue : retire la file de rafraîchissement et ses
-- triggers. Le cache PDF (0025) et la logique de rendu ne sont pas touchés.

DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.tour_lignes;
DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.lv_projets;
DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.lv_prestations;
DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.tours;
DROP TRIGGER IF EXISTS trg_lv_pdf_dirty ON bon.lettres_voiture;

DROP FUNCTION IF EXISTS bon.trg_lv_pdf_dirty_tourline();
DROP FUNCTION IF EXISTS bon.trg_lv_pdf_dirty_child();
DROP FUNCTION IF EXISTS bon.trg_lv_pdf_dirty_self();
DROP FUNCTION IF EXISTS bon.mark_lv_pdf_dirty(bigint);

DROP TABLE IF EXISTS bon.lv_pdf_dirty;
