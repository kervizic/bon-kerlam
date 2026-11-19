-- down 0030 : retire la colonne template_version du cache PDF.
ALTER TABLE bon.lv_pdf_cache DROP COLUMN IF EXISTS template_version;
