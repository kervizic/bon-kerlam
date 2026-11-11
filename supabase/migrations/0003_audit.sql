-- @migration:     0003_audit
-- @description:   Journal d'audit par LV (déclencheurs) et annulation (undo)
--                 limitée aux actions de son auteur, jamais au-delà d'une signature.
-- @role:          superuser
-- @transactional: true
-- @baseline:      false
-- @down:          DROP TABLE bon.audit_log; DROP des fonctions/triggers d'audit.

-- Acteur courant : e-mail du JWT, ou GUC bon.actor (tests / worker).
CREATE OR REPLACE FUNCTION bon.current_actor() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    NULLIF(current_setting('bon.actor', true), ''))
$$;

CREATE OR REPLACE FUNCTION bon.via_ia() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('bon.via_ia', true), 'off') = 'on'
$$;

CREATE TABLE IF NOT EXISTS bon.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lv_id       bigint,
  entity      text   NOT NULL,     -- lettres_voiture | tours | tour_lignes
  entity_id   bigint,
  action      text   NOT NULL,     -- insert | update | delete
  actor_email text,
  via_ia      boolean NOT NULL DEFAULT false,
  before      jsonb,
  after       jsonb,
  undone      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_lv_idx ON bon.audit_log (lv_id, id DESC);

-- Déclencheur générique d'audit pour les tables de LV.
CREATE OR REPLACE FUNCTION bon.trg_audit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = bon, pg_temp AS $$
DECLARE
  v_lv    bigint;
  v_eid   bigint;
  v_before jsonb;
  v_after  jsonb;
BEGIN
  IF COALESCE(current_setting('bon.suppress_audit', true), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'lettres_voiture' THEN
    v_lv := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'tours' THEN
    v_lv := COALESCE(NEW.lv_id, OLD.lv_id);
  ELSE  -- tour_lignes
    SELECT lv_id INTO v_lv FROM bon.tours
     WHERE id = COALESCE((NEW).tour_id, (OLD).tour_id);
  END IF;

  v_eid := COALESCE(NEW.id, OLD.id);
  IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_after  := to_jsonb(NEW); END IF;

  INSERT INTO bon.audit_log (lv_id, entity, entity_id, action, actor_email, via_ia, before, after)
  VALUES (v_lv, TG_TABLE_NAME, v_eid, lower(TG_OP), bon.current_actor(), bon.via_ia(), v_before, v_after);

  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['lettres_voiture','tours','tour_lignes']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON bon.%1$I;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON bon.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION bon.trg_audit();', t);
  END LOOP;
END $$;

-- Ré-application de l'état « before » d'une entité (UPDATE complet de la ligne).
CREATE OR REPLACE FUNCTION bon._apply_before(p_entity text, p_id bigint, p_before jsonb)
  RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE v_set text;
BEGIN
  -- On exclut la colonne d'identité (GENERATED ALWAYS) et les colonnes générées :
  -- elles ne sont pas modifiables par UPDATE et l'identité est fixée par le WHERE.
  SELECT string_agg(format('%I = src.%I', column_name, column_name), ', ')
    INTO v_set
    FROM information_schema.columns
   WHERE table_schema = 'bon' AND table_name = p_entity
     AND is_identity = 'NO' AND is_generated = 'NEVER';
  EXECUTE format(
    'UPDATE bon.%1$I AS tgt SET %2$s '
    'FROM jsonb_populate_record(NULL::bon.%1$I, $1) AS src WHERE tgt.id = $2',
    p_entity, v_set) USING p_before, p_id;
END $$;

-- Annulation de la DERNIÈRE action de l'acteur courant sur une LV.
-- Règles : LV signée => interdit ; on ne remonte jamais au-delà d'une signature ;
-- chacun n'annule que SES propres actions.
CREATE OR REPLACE FUNCTION bon.lv_undo(p_lv_id bigint)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = bon, pg_temp
AS $$
DECLARE
  v_actor   text := bon.current_actor();
  v_statut  bon.statut_lv;
  v_sign_id bigint;
  r         bon.audit_log;
BEGIN
  SELECT statut INTO v_statut FROM bon.lettres_voiture WHERE id = p_lv_id;
  IF v_statut IS NULL THEN
    RAISE EXCEPTION 'LV introuvable: %', p_lv_id;
  END IF;
  IF v_statut = 'signee' THEN
    RAISE EXCEPTION 'LV signée : annulation impossible';
  END IF;

  -- Barrière : dernière signature enregistrée pour cette LV.
  SELECT max(id) INTO v_sign_id
    FROM bon.audit_log
   WHERE lv_id = p_lv_id AND entity = 'lettres_voiture'
     AND (after ->> 'statut') = 'signee';

  SELECT * INTO r
    FROM bon.audit_log
   WHERE lv_id = p_lv_id
     AND undone = false
     AND actor_email IS NOT DISTINCT FROM v_actor
     AND (v_sign_id IS NULL OR id > v_sign_id)
   ORDER BY id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('undone', false, 'reason', 'aucune action annulable');
  END IF;

  -- On applique l'inverse sans ré-auditer.
  PERFORM set_config('bon.suppress_audit', 'on', true);

  IF r.action = 'insert' THEN
    EXECUTE format('DELETE FROM bon.%I WHERE id = $1', r.entity) USING r.entity_id;
  ELSIF r.action = 'delete' THEN
    EXECUTE format(
      'INSERT INTO bon.%1$I OVERRIDING SYSTEM VALUE '
      'SELECT * FROM jsonb_populate_record(NULL::bon.%1$I, $1)', r.entity) USING r.before;
  ELSE  -- update
    PERFORM bon._apply_before(r.entity, r.entity_id, r.before);
  END IF;

  PERFORM set_config('bon.suppress_audit', 'off', true);

  UPDATE bon.audit_log SET undone = true WHERE id = r.id;

  RETURN jsonb_build_object('undone', true, 'audit_id', r.id,
                            'entity', r.entity, 'action', r.action);
END $$;
