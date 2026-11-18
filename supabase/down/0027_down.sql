-- down 0027_beta29_lv_signee_immuable : retire l'immutabilité des lettres signées.
DROP TRIGGER IF EXISTS trg_lv_signee_immuable ON bon.lettres_voiture;
DROP FUNCTION IF EXISTS bon.trg_lv_signee_immuable();
