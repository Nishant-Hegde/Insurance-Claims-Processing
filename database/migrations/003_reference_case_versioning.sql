-- Migration 003: reference-case versioning, audit and keyword search.
-- Apply after 002_risk_rule_fk_and_procedure.sql:
--   psql -v ON_ERROR_STOP=1 -d <db> -f database/migrations/003_reference_case_versioning.sql
--
-- Why versioning instead of UPDATE:
--   fn_ref_case_immutable (schema v4) forbids changing a reference case's title, description,
--   model or embedding after insert, because past screening_match rows point at that exact
--   evidence. Rewriting it would silently change what an adjuster saw when deciding a claim.
--   So "edit" and "re-embed" are done as: deactivate the old row + insert a new row that
--   records which row it replaces (supersedes_case_id). Old matches stay valid; new
--   screenings only see the active version.
BEGIN;

-- 0. Identity sequences. claimguard_seed_v1.sql inserts embedding_model and risk_rule rows with
--    explicit ids (OVERRIDING SYSTEM VALUE), which does not advance the identity sequence, so
--    the next normal INSERT would collide with id 1. Move each sequence past the highest id.
SELECT setval(pg_get_serial_sequence('embedding_model', 'model_id'),
              coalesce((SELECT max(model_id) FROM embedding_model), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('risk_rule', 'risk_rule_id'),
              coalesce((SELECT max(risk_rule_id) FROM risk_rule), 0) + 1, false);

-- 1. Version link: a new row may name the row it replaces (at most one successor each).
ALTER TABLE reference_fraud_case
    ADD COLUMN supersedes_case_id uuid
        REFERENCES reference_fraud_case (case_id) ON DELETE RESTRICT,
    ADD CONSTRAINT uq_ref_case_supersedes UNIQUE (supersedes_case_id),
    ADD CONSTRAINT ck_ref_case_supersedes_self CHECK (supersedes_case_id IS DISTINCT FROM case_id);

-- The link is part of the case's history: it cannot be changed after insert.
CREATE FUNCTION fn_ref_case_lineage_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.supersedes_case_id IS DISTINCT FROM OLD.supersedes_case_id THEN
        RAISE EXCEPTION 'supersedes_case_id is immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_ref_case_lineage_immutable
    BEFORE UPDATE OF supersedes_case_id ON reference_fraud_case
    FOR EACH ROW EXECUTE FUNCTION fn_ref_case_lineage_immutable();

-- A superseded row must already be inactive by the time its successor is committed
-- (sp_revise_reference_case does both in one transaction).
CREATE FUNCTION fn_ref_case_supersede_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.supersedes_case_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM reference_fraud_case
        WHERE case_id = NEW.supersedes_case_id AND is_active) THEN
        RAISE EXCEPTION 'case % is still active; deactivate it before adding its new version',
            NEW.supersedes_case_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_ref_case_supersede_check
    BEFORE INSERT ON reference_fraud_case
    FOR EACH ROW EXECUTE FUNCTION fn_ref_case_supersede_check();

-- 2. Audit (the schema defines REFERENCE_CASE_ADDED / _DEACTIVATED but never writes them).
CREATE FUNCTION fn_ref_case_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (actor_type, actor_id, action, reference_case_id, details)
        VALUES ('USER', NEW.created_by, 'REFERENCE_CASE_ADDED', NEW.case_id,
                jsonb_build_object('source', 'database_trigger', 'title', NEW.title,
                                   'embedding_model_id', NEW.embedding_model_id,
                                   'supersedes_case_id', NEW.supersedes_case_id));
    ELSIF OLD.is_active AND NOT NEW.is_active THEN
        INSERT INTO audit_log (actor_type, actor_id, action, reference_case_id, details)
        VALUES ('USER', NEW.deactivated_by, 'REFERENCE_CASE_DEACTIVATED', NEW.case_id,
                jsonb_build_object('source', 'database_trigger', 'title', NEW.title));
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_ref_case_audit
    AFTER INSERT OR UPDATE OF is_active ON reference_fraud_case
    FOR EACH ROW EXECUTE FUNCTION fn_ref_case_audit();

-- 3. Keyword (full-text) search over title + description for the admin list.
CREATE INDEX ix_ref_case_fts ON reference_fraud_case
    USING gin (to_tsvector('english', title || ' ' || description));

-- 4. Atomic "edit": deactivate the old version and insert the new one together.
--    Role checks come from the existing triggers: both the deactivator and the creator
--    must be active ADMIN users (trg_ref_case_deactivator_role, trg_ref_case_creator_role).
CREATE PROCEDURE sp_revise_reference_case(
    p_case_id            uuid,
    p_admin_id           uuid,
    p_title              varchar,
    p_description        text,
    p_embedding_model_id integer,
    p_embedding          vector,
    INOUT p_new_case_id  uuid DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_old reference_fraud_case%ROWTYPE;
BEGIN
    SELECT * INTO v_old FROM reference_fraud_case WHERE case_id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reference case % does not exist', p_case_id
            USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT v_old.is_active THEN
        RAISE EXCEPTION 'reference case % is inactive; only the active version can be revised', p_case_id
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE reference_fraud_case
    SET    is_active = false, deactivated_by = p_admin_id, deactivated_at = now()
    WHERE  case_id = p_case_id;

    INSERT INTO reference_fraud_case
        (title, description, is_confirmed, is_active, embedding_model_id, embedding,
         created_by, supersedes_case_id)
    VALUES
        (btrim(p_title), btrim(p_description), v_old.is_confirmed, true, p_embedding_model_id,
         p_embedding, p_admin_id, p_case_id)
    RETURNING case_id INTO p_new_case_id;
END $$;

COMMENT ON PROCEDURE sp_revise_reference_case(uuid, uuid, varchar, text, integer, vector, uuid) IS
    'Edit a reference case without rewriting history: deactivate the old row and insert a '
    'linked new version (supersedes_case_id), atomically.';

COMMIT;
