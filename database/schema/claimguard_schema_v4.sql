-- ClaimGuard relational schema v4.1 (SRS v2.0 alignment; FK integrity fixes)
-- Requires: PostgreSQL 13+ and pgvector 0.5+ (HNSW). Tested: PostgreSQL 16.15 + pgvector 0.6.0.
-- Run once on an empty database:  psql -v ON_ERROR_STOP=1 -d <db> -f claimguard_schema.sql
-- No psql variables or meta-commands are used, so any runner (psql, pgAdmin, Prisma raw SQL) works.
--
-- ASSUMPTION (not an SRS requirement): embedding dimension is 384 (placeholder for a common
-- sentence-embedding model). To change it, replace every literal 384 in this file BEFORE the
-- first run (vector(384) x2, ck_embedding_model_dim, zero-vector checks). pgvector HNSW supports
-- at most 2000 dimensions.
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- 1. Lookup and identity tables
-- ---------------------------------------------------------------------------
CREATE TABLE app_role (
    role_id    smallint    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name  varchar(30) NOT NULL UNIQUE,
    CONSTRAINT ck_app_role_name
        CHECK (role_name IN ('POLICYHOLDER', 'CLAIMS_ADJUSTER', 'ADMIN'))
);

INSERT INTO app_role (role_name)
VALUES ('POLICYHOLDER'), ('CLAIMS_ADJUSTER'), ('ADMIN');

CREATE TABLE app_user (
    user_id        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id        smallint     NOT NULL REFERENCES app_role (role_id) ON DELETE RESTRICT,
    email          varchar(254) NOT NULL,
    password_hash  varchar(255) NOT NULL,              -- hash only, never plaintext (FR-01)
    full_name      varchar(120) NOT NULL,
    is_active      boolean      NOT NULL DEFAULT true, -- deactivate instead of delete
    created_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_app_user_email CHECK (position('@' IN email) > 1),
    CONSTRAINT ck_app_user_hash  CHECK (btrim(password_hash) <> ''),
    CONSTRAINT ck_app_user_name  CHECK (btrim(full_name) <> '')
);
CREATE UNIQUE INDEX ux_app_user_email ON app_user (lower(email));

CREATE TABLE embedding_model (
    model_id       integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model_name     varchar(120) NOT NULL,
    model_version  varchar(60)  NOT NULL,
    dimension      integer      NOT NULL,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_embedding_model UNIQUE (model_name, model_version),
    -- the vector(384) columns fix the dimension, so a registered model must match it
    CONSTRAINT ck_embedding_model_dim CHECK (dimension = 384)
);

-- ---------------------------------------------------------------------------
-- 2. Policies and reference fraud cases
-- ---------------------------------------------------------------------------
CREATE TABLE policy (
    policy_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_number   varchar(40) NOT NULL UNIQUE,
    holder_id       uuid        NOT NULL REFERENCES app_user (user_id) ON DELETE RESTRICT,
    effective_date  date        NOT NULL,
    expiry_date     date        NOT NULL,
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_policy_dates CHECK (expiry_date > effective_date),
    CONSTRAINT uq_policy_id_holder UNIQUE (policy_id, holder_id)   -- target of claim ownership FK
);

CREATE TABLE reference_fraud_case (
    case_id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    title               varchar(150) NOT NULL,
    description         text         NOT NULL,
    is_confirmed        boolean      NOT NULL DEFAULT true,
    is_active           boolean      NOT NULL DEFAULT true,
    embedding_model_id  integer      NOT NULL REFERENCES embedding_model (model_id) ON DELETE RESTRICT,
    embedding           vector(384) NOT NULL,   -- stored at insert: a case is never searchable without it
    created_by          uuid         NOT NULL REFERENCES app_user (user_id) ON DELETE RESTRICT,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    deactivated_by      uuid         REFERENCES app_user (user_id) ON DELETE RESTRICT,
    deactivated_at      timestamptz,
    CONSTRAINT ck_ref_case_title CHECK (btrim(title) <> ''),
    CONSTRAINT ck_ref_case_description CHECK (btrim(description) <> ''),
    -- an all-zero vector is silently skipped by the cosine HNSW index, i.e. unsearchable
    CONSTRAINT ck_ref_case_embedding_nonzero CHECK (embedding <> array_fill(0, ARRAY[384])::vector),
    CONSTRAINT ck_ref_case_deactivation
        CHECK (is_active = (deactivated_at IS NULL)
               AND (deactivated_at IS NULL) = (deactivated_by IS NULL)),
    CONSTRAINT uq_ref_case_id_model UNIQUE (case_id, embedding_model_id)  -- target of match model FK
);

-- ---------------------------------------------------------------------------
-- 3. Claims and screening
-- ---------------------------------------------------------------------------
CREATE TABLE claim (
    claim_id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id         uuid          NOT NULL,
    claimant_id       uuid          NOT NULL,
    incident_date     date          NOT NULL,
    claimed_amount    numeric(12,2) NOT NULL,
    description       text          NOT NULL,
    claim_status      varchar(20)   NOT NULL DEFAULT 'SUBMITTED',
    screening_status  varchar(10)   NOT NULL DEFAULT 'PENDING',
    review_required   boolean       NOT NULL DEFAULT false,
    submitted_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    -- claim owner must be the holder of the referenced policy
    CONSTRAINT fk_claim_policy_owner FOREIGN KEY (policy_id, claimant_id)
        REFERENCES policy (policy_id, holder_id) ON DELETE RESTRICT,
    CONSTRAINT ck_claim_amount      CHECK (claimed_amount > 0),
    CONSTRAINT ck_claim_description CHECK (btrim(description) <> ''),
    CONSTRAINT ck_claim_status
        CHECK (claim_status IN ('SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INFO', 'DECIDED')),
    CONSTRAINT ck_claim_screening_status
        CHECK (screening_status IN ('PENDING', 'COMPLETED', 'FAILED'))
);

CREATE TABLE screening_assessment (
    assessment_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id               uuid        NOT NULL REFERENCES claim (claim_id) ON DELETE RESTRICT,
    attempt_no             integer     NOT NULL,
    status                 varchar(10) NOT NULL,
    outcome                varchar(15),
    risk_indicator         varchar(30),          -- vocabulary fixed by the documented risk rules (not by the SRS)
    risk_rule_version      varchar(40),
    failure_reason         text,
    embedding_model_id     integer     REFERENCES embedding_model (model_id) ON DELETE RESTRICT,
    description_embedding  vector(384),
    top_k                  integer,
    similarity_metric      varchar(30),          -- records how similarity_score must be read
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_assessment_claim_attempt UNIQUE (claim_id, attempt_no),   -- idempotent retries
    CONSTRAINT uq_assessment_id_claim      UNIQUE (assessment_id, claim_id),
    CONSTRAINT uq_assessment_id_model      UNIQUE (assessment_id, embedding_model_id),
    CONSTRAINT ck_assessment_attempt CHECK (attempt_no > 0),
    CONSTRAINT ck_assessment_status  CHECK (status IN ('COMPLETED', 'FAILED')),
    CONSTRAINT ck_assessment_outcome CHECK (outcome IN ('MATCHES_FOUND', 'NO_MATCH')),
    CONSTRAINT ck_assessment_top_k   CHECK (top_k > 0),
    CONSTRAINT ck_assessment_embedding_nonzero
        CHECK (description_embedding IS NULL OR description_embedding <> array_fill(0, ARRAY[384])::vector),
    CONSTRAINT ck_assessment_failure_reason CHECK (failure_reason IS NULL OR btrim(failure_reason) <> ''),
    CONSTRAINT ck_assessment_completed
        CHECK (status <> 'COMPLETED'
               OR (outcome IS NOT NULL AND risk_indicator IS NOT NULL
                   AND risk_rule_version IS NOT NULL
                   AND embedding_model_id IS NOT NULL AND description_embedding IS NOT NULL
                   AND top_k IS NOT NULL AND similarity_metric IS NOT NULL
                   AND failure_reason IS NULL)),
    CONSTRAINT ck_assessment_failed
        CHECK (status <> 'FAILED'
               OR (outcome IS NULL AND risk_indicator IS NULL AND risk_rule_version IS NULL
                   AND failure_reason IS NOT NULL))   -- a failure never carries a risk result
);

CREATE TABLE screening_match (
    match_id            bigint           GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assessment_id       uuid             NOT NULL,
    reference_case_id   uuid             NOT NULL,
    embedding_model_id  integer          NOT NULL,
    match_rank          integer          NOT NULL,
    similarity_score    double precision NOT NULL,   -- advisory; NOT a fraud probability
    CONSTRAINT ck_match_rank CHECK (match_rank > 0),
    CONSTRAINT uq_match_assessment_rank UNIQUE (assessment_id, match_rank),
    CONSTRAINT uq_match_assessment_case UNIQUE (assessment_id, reference_case_id),
    -- both vectors must come from the same embedding model
    CONSTRAINT fk_match_assessment FOREIGN KEY (assessment_id, embedding_model_id)
        REFERENCES screening_assessment (assessment_id, embedding_model_id) ON DELETE RESTRICT,
    CONSTRAINT fk_match_reference_case FOREIGN KEY (reference_case_id, embedding_model_id)
        REFERENCES reference_fraud_case (case_id, embedding_model_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- 4. Review, decision, audit
-- ---------------------------------------------------------------------------
CREATE TABLE review (
    review_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id       uuid        NOT NULL REFERENCES claim (claim_id) ON DELETE RESTRICT,
    assessment_id  uuid,                              -- evidence the adjuster examined (may be NULL)
    reviewer_id    uuid        NOT NULL REFERENCES app_user (user_id) ON DELETE RESTRICT,
    review_action  varchar(15) NOT NULL,
    notes          text        NOT NULL,
    reviewed_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_review_action CHECK (review_action IN ('APPROVED', 'REJECTED', 'INFO_REQUESTED')),
    CONSTRAINT ck_review_notes  CHECK (btrim(notes) <> ''),
    CONSTRAINT uq_review_claim_action UNIQUE (review_id, claim_id, review_action),
    -- Required as the exact referenced key for information_response(review_id, claim_id).
    CONSTRAINT uq_review_id_claim UNIQUE (review_id, claim_id),
    CONSTRAINT fk_review_assessment FOREIGN KEY (assessment_id, claim_id)
        REFERENCES screening_assessment (assessment_id, claim_id) ON DELETE RESTRICT
);

CREATE TABLE claim_decision (
    decision_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id         uuid        NOT NULL UNIQUE,     -- at most one final decision per claim
    review_id        uuid        NOT NULL UNIQUE,     -- the review that produced it
    decision_status  varchar(15) NOT NULL,
    decided_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_decision_status CHECK (decision_status IN ('APPROVED', 'REJECTED')),
    -- decision must mirror a review of the same claim with the same action
    CONSTRAINT fk_decision_review FOREIGN KEY (review_id, claim_id, decision_status)
        REFERENCES review (review_id, claim_id, review_action) ON DELETE RESTRICT
);

CREATE TABLE audit_log (
    audit_id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at        timestamptz NOT NULL DEFAULT now(),
    actor_type         varchar(6)  NOT NULL,
    actor_id           uuid        REFERENCES app_user (user_id) ON DELETE RESTRICT,
    action             varchar(40) NOT NULL,
    claim_id           uuid        REFERENCES claim (claim_id) ON DELETE RESTRICT,
    reference_case_id  uuid        REFERENCES reference_fraud_case (case_id) ON DELETE RESTRICT,
    target_user_id     uuid        REFERENCES app_user (user_id) ON DELETE RESTRICT,
    assessment_id      uuid,
    details            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('USER', 'SYSTEM')),
    CONSTRAINT ck_audit_actor      CHECK ((actor_type = 'USER') = (actor_id IS NOT NULL)),
    CONSTRAINT ck_audit_action CHECK (action IN (
        'CLAIM_SUBMITTED', 'SCREENING_COMPLETED', 'SCREENING_FAILED',
        'REVIEW_RECORDED', 'DECISION_RECORDED',
        'REFERENCE_CASE_ADDED', 'REFERENCE_CASE_DEACTIVATED',
        'USER_CREATED', 'USER_ROLE_CHANGED', 'USER_STATUS_CHANGED',
        'POLICY_ISSUED', 'INFORMATION_RESPONSE_ADDED', 'NOTIFICATION_DISMISSED')),
    CONSTRAINT ck_audit_one_target CHECK (num_nonnulls(claim_id, reference_case_id, target_user_id) = 1),
    CONSTRAINT ck_audit_assessment CHECK (assessment_id IS NULL OR claim_id IS NOT NULL),
    -- the referenced assessment must belong to the referenced claim
    CONSTRAINT fk_audit_assessment FOREIGN KEY (assessment_id, claim_id)
        REFERENCES screening_assessment (assessment_id, claim_id) ON DELETE RESTRICT,
    -- each action must point at the kind of target it concerns
    CONSTRAINT ck_audit_action_target CHECK (
        CASE
            WHEN action IN ('CLAIM_SUBMITTED', 'SCREENING_COMPLETED', 'SCREENING_FAILED',
                            'REVIEW_RECORDED', 'DECISION_RECORDED') THEN claim_id IS NOT NULL
            WHEN action IN ('REFERENCE_CASE_ADDED', 'REFERENCE_CASE_DEACTIVATED') THEN reference_case_id IS NOT NULL
            WHEN action = 'INFORMATION_RESPONSE_ADDED' THEN claim_id IS NOT NULL
            WHEN action IN ('POLICY_ISSUED', 'NOTIFICATION_DISMISSED') THEN target_user_id IS NOT NULL
            ELSE target_user_id IS NOT NULL
        END)
);

-- ---------------------------------------------------------------------------
-- 5. Indexes (FK columns not already covered by a constraint index, plus query paths)
-- ---------------------------------------------------------------------------
CREATE INDEX ix_app_user_role             ON app_user (role_id);
CREATE INDEX ix_policy_holder             ON policy (holder_id);
CREATE INDEX ix_ref_case_model            ON reference_fraud_case (embedding_model_id);
CREATE INDEX ix_ref_case_created_by       ON reference_fraud_case (created_by);
CREATE INDEX ix_ref_case_deactivated_by   ON reference_fraud_case (deactivated_by) WHERE deactivated_by IS NOT NULL;
CREATE INDEX ix_assessment_model          ON screening_assessment (embedding_model_id) WHERE embedding_model_id IS NOT NULL;
CREATE INDEX ix_claim_claimant_submitted  ON claim (claimant_id, submitted_at DESC);   -- FR-04
CREATE INDEX ix_claim_policy              ON claim (policy_id);
CREATE INDEX ix_claim_queue               ON claim (claim_status, screening_status, submitted_at); -- FR-05, FR-15
CREATE INDEX ix_match_reference_case      ON screening_match (reference_case_id);
CREATE INDEX ix_review_claim              ON review (claim_id, reviewed_at);
CREATE INDEX ix_review_reviewer           ON review (reviewer_id);
CREATE INDEX ix_review_assessment         ON review (assessment_id, claim_id) WHERE assessment_id IS NOT NULL;
CREATE INDEX ix_audit_claim               ON audit_log (claim_id, occurred_at);
CREATE INDEX ix_audit_actor               ON audit_log (actor_id, occurred_at);
CREATE INDEX ix_audit_reference_case      ON audit_log (reference_case_id) WHERE reference_case_id IS NOT NULL;
CREATE INDEX ix_audit_target_user         ON audit_log (target_user_id) WHERE target_user_id IS NOT NULL;
-- one screening audit event per attempt (idempotent retries); review/decision events may
-- legitimately reference the same assessment many times, so they are excluded.
CREATE UNIQUE INDEX ux_audit_attempt_action ON audit_log (assessment_id, action)
    WHERE assessment_id IS NOT NULL AND action IN ('SCREENING_COMPLETED', 'SCREENING_FAILED');

-- ASSUMPTION: cosine distance + HNSW. The operator class must match the operator used in
-- queries (<=> for vector_cosine_ops). Metric and index type are not fixed by the SRS.
CREATE INDEX ix_ref_case_embedding_hnsw
    ON reference_fraud_case USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
    WHERE is_active AND is_confirmed;
-- Query shape that uses this index (predicate must imply the index WHERE; ORDER BY must use <=>):
--   SELECT case_id, 1 - (embedding <=> $1) FROM reference_fraud_case
--   WHERE is_active AND is_confirmed AND embedding_model_id = $2 ORDER BY embedding <=> $1 LIMIT $3;
-- HNSW returns at most hnsw.ef_search (default 40) rows: keep top_k <= ef_search, or SET it per query.

-- ---------------------------------------------------------------------------
-- 6. Functions and triggers
-- ---------------------------------------------------------------------------

-- 6.1 A user referenced by a role-bound column must be active and hold the required role.
CREATE FUNCTION fn_require_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_user   uuid;
    v_role   text;
    v_active boolean;
BEGIN
    v_user := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::uuid;
    IF v_user IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT r.role_name, u.is_active INTO v_role, v_active
    FROM app_user u JOIN app_role r USING (role_id)
    WHERE u.user_id = v_user;
    IF v_role IS DISTINCT FROM TG_ARGV[1] OR v_active IS NOT TRUE THEN
        RAISE EXCEPTION 'user % must be an active % for column %', v_user, TG_ARGV[1], TG_ARGV[0]
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_policy_holder_role
    BEFORE INSERT OR UPDATE OF holder_id ON policy
    FOR EACH ROW EXECUTE FUNCTION fn_require_role('holder_id', 'POLICYHOLDER');
CREATE TRIGGER trg_review_reviewer_role
    BEFORE INSERT ON review
    FOR EACH ROW EXECUTE FUNCTION fn_require_role('reviewer_id', 'CLAIMS_ADJUSTER');
CREATE TRIGGER trg_ref_case_creator_role
    BEFORE INSERT ON reference_fraud_case
    FOR EACH ROW EXECUTE FUNCTION fn_require_role('created_by', 'ADMIN');
CREATE TRIGGER trg_ref_case_deactivator_role
    BEFORE UPDATE OF deactivated_by ON reference_fraud_case
    FOR EACH ROW EXECUTE FUNCTION fn_require_role('deactivated_by', 'ADMIN');

-- A role cannot change once the user appears in role-bound history (keeps old rows valid).
CREATE FUNCTION fn_user_role_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.role_id IS DISTINCT FROM OLD.role_id AND (
           EXISTS (SELECT 1 FROM policy WHERE holder_id = OLD.user_id)
        OR EXISTS (SELECT 1 FROM review WHERE reviewer_id = OLD.user_id)
        OR EXISTS (SELECT 1 FROM reference_fraud_case
                   WHERE created_by = OLD.user_id OR deactivated_by = OLD.user_id)) THEN
        RAISE EXCEPTION 'role of user % cannot change: user appears in role-bound records', OLD.user_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_user_role_change_guard
    BEFORE UPDATE OF role_id ON app_user
    FOR EACH ROW EXECUTE FUNCTION fn_user_role_change_guard();

-- 6.2 History tables are append-only; core tables are never hard-deleted (no DELETE/TRUNCATE).
CREATE FUNCTION fn_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% does not allow % (history is preserved)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['audit_log', 'screening_assessment', 'screening_match', 'review', 'claim_decision'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_forbid_mutation()', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_no_truncate BEFORE TRUNCATE ON %I
                        FOR EACH STATEMENT EXECUTE FUNCTION fn_forbid_mutation()', t, t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['app_user', 'policy', 'claim', 'reference_fraud_case'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%s_no_delete BEFORE DELETE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_forbid_mutation()', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_no_truncate BEFORE TRUNCATE ON %I
                        FOR EACH STATEMENT EXECUTE FUNCTION fn_forbid_mutation()', t, t);
    END LOOP;
END $$;

-- 6.3 Claim integrity.
-- 6.3a New claims start SUBMITTED/PENDING on an active policy, for a date inside the coverage period.
CREATE FUNCTION fn_claim_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_pol policy%ROWTYPE;
BEGIN
    IF NEW.claim_status <> 'SUBMITTED' OR NEW.screening_status <> 'PENDING' THEN
        RAISE EXCEPTION 'a new claim must start as SUBMITTED with PENDING screening'
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_pol FROM policy WHERE policy_id = NEW.policy_id;
    IF FOUND THEN   -- a missing policy is reported by the foreign key
        IF NOT v_pol.is_active THEN
            RAISE EXCEPTION 'policy % is not active', NEW.policy_id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.incident_date < v_pol.effective_date OR NEW.incident_date > v_pol.expiry_date
           OR NEW.incident_date > CURRENT_DATE THEN
            RAISE EXCEPTION 'incident_date % is outside the policy period or in the future', NEW.incident_date
                USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app_user WHERE user_id = NEW.claimant_id AND is_active) THEN
            RAISE EXCEPTION 'claimant % is not an active user', NEW.claimant_id USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_claim_insert_guard
    BEFORE INSERT ON claim
    FOR EACH ROW EXECUTE FUNCTION fn_claim_insert_guard();

-- 6.3b Submitted claim content (the evidence that was embedded) cannot be altered.
CREATE FUNCTION fn_claim_core_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.claim_id, NEW.policy_id, NEW.claimant_id, NEW.incident_date, NEW.claimed_amount,
        NEW.description, NEW.submitted_at)
       IS DISTINCT FROM
       (OLD.claim_id, OLD.policy_id, OLD.claimant_id, OLD.incident_date, OLD.claimed_amount,
        OLD.description, OLD.submitted_at) THEN
        RAISE EXCEPTION 'submitted claim content is immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_claim_core_immutable
    BEFORE UPDATE ON claim
    FOR EACH ROW EXECUTE FUNCTION fn_claim_core_immutable();

-- 6.3c Status transitions. screening_status and the DECIDED status may only be set by the
--      screening/decision triggers (pg_trigger_depth() >= 2 = update issued from inside a trigger).
--      Direct application updates may only move SUBMITTED/UNDER_REVIEW/AWAITING_INFO as listed.
CREATE FUNCTION fn_claim_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.claim_status = 'DECIDED'
       AND (NEW.claim_status, NEW.screening_status, NEW.review_required)
           IS DISTINCT FROM (OLD.claim_status, OLD.screening_status, OLD.review_required) THEN
        RAISE EXCEPTION 'claim % is decided and final', OLD.claim_id USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.screening_status IS DISTINCT FROM OLD.screening_status AND pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'screening_status is maintained by screening_assessment inserts only'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.claim_status IS DISTINCT FROM OLD.claim_status THEN
        IF NEW.claim_status = 'DECIDED' THEN
            IF pg_trigger_depth() < 2 THEN
                RAISE EXCEPTION 'a claim becomes DECIDED only by inserting a claim_decision'
                    USING ERRCODE = 'restrict_violation';
            END IF;
        ELSIF (OLD.claim_status, NEW.claim_status) NOT IN
              (('SUBMITTED', 'UNDER_REVIEW'), ('SUBMITTED', 'AWAITING_INFO'),
               ('UNDER_REVIEW', 'AWAITING_INFO'), ('AWAITING_INFO', 'UNDER_REVIEW')) THEN
            RAISE EXCEPTION 'invalid claim_status transition % -> %', OLD.claim_status, NEW.claim_status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_claim_state_guard
    BEFORE UPDATE ON claim
    FOR EACH ROW EXECUTE FUNCTION fn_claim_state_guard();

-- 6.4 Reference cases: only a one-way, one-time deactivation is allowed after creation.
CREATE FUNCTION fn_ref_case_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.title, NEW.description, NEW.is_confirmed, NEW.embedding_model_id,
        NEW.embedding, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.title, OLD.description, OLD.is_confirmed, OLD.embedding_model_id,
        OLD.embedding, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'reference case content is immutable; deactivate instead'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT OLD.is_active AND NEW.is_active THEN
        RAISE EXCEPTION 'reference cases cannot be reactivated' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.deactivated_at IS NOT NULL
       AND (NEW.deactivated_at, NEW.deactivated_by) IS DISTINCT FROM (OLD.deactivated_at, OLD.deactivated_by) THEN
        RAISE EXCEPTION 'deactivation record is immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_ref_case_immutable
    BEFORE UPDATE ON reference_fraud_case
    FOR EACH ROW EXECUTE FUNCTION fn_ref_case_immutable();

-- 6.5 Screening attempts. BEFORE: serialize on the claim, reject attempts on decided or already
--     screened claims, and stamp created_at with the transaction time (so matches can be tied to
--     the same transaction, see 6.7). AFTER: keep claim.screening_status in step.
CREATE FUNCTION fn_assessment_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_claim_status varchar(20);
    v_screening    varchar(10);
BEGIN
    SELECT claim_status, screening_status INTO v_claim_status, v_screening
    FROM claim WHERE claim_id = NEW.claim_id FOR UPDATE;
    IF v_claim_status = 'DECIDED' THEN
        RAISE EXCEPTION 'claim % is already decided', NEW.claim_id USING ERRCODE = 'check_violation';
    END IF;
    IF v_screening = 'COMPLETED' THEN
        RAISE EXCEPTION 'claim % already has a completed screening', NEW.claim_id
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_assessment_before_insert
    BEFORE INSERT ON screening_assessment
    FOR EACH ROW EXECUTE FUNCTION fn_assessment_before_insert();

CREATE FUNCTION fn_assessment_sync_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE claim SET screening_status = NEW.status WHERE claim_id = NEW.claim_id;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_assessment_sync_claim
    AFTER INSERT ON screening_assessment
    FOR EACH ROW EXECUTE FUNCTION fn_assessment_sync_claim();

-- 6.6 Approval guard (FR-09, BR-05). The service checks first; these are defence in depth.
--     An APPROVED review can only exist if approval is currently allowed, and decisions are final.
CREATE FUNCTION fn_assert_approvable(p_claim uuid, p_assessment uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_screening varchar(10);
    v_basis     varchar(10);
BEGIN
    SELECT screening_status INTO v_screening
    FROM claim WHERE claim_id = p_claim FOR UPDATE;
    IF v_screening IS DISTINCT FROM 'COMPLETED' THEN
        RAISE EXCEPTION 'approval blocked: screening status is %', v_screening
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT status INTO v_basis
    FROM screening_assessment WHERE assessment_id = p_assessment AND claim_id = p_claim;
    IF v_basis IS DISTINCT FROM 'COMPLETED' THEN
        RAISE EXCEPTION 'approval blocked: review did not examine a completed assessment of this claim'
            USING ERRCODE = 'check_violation';
    END IF;
END $$;

CREATE FUNCTION fn_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_status varchar(20);
BEGIN
    SELECT claim_status INTO v_status FROM claim WHERE claim_id = NEW.claim_id FOR UPDATE;
    IF v_status = 'DECIDED' THEN
        RAISE EXCEPTION 'claim % is already decided', NEW.claim_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.review_action = 'APPROVED' THEN
        PERFORM fn_assert_approvable(NEW.claim_id, NEW.assessment_id);
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_review_guard
    BEFORE INSERT ON review
    FOR EACH ROW EXECUTE FUNCTION fn_review_guard();

CREATE FUNCTION fn_claim_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_status     varchar(20);
    v_assessment uuid;
BEGIN
    SELECT claim_status INTO v_status FROM claim WHERE claim_id = NEW.claim_id FOR UPDATE;
    IF v_status = 'DECIDED' THEN
        RAISE EXCEPTION 'claim % is already decided', NEW.claim_id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_status = 'APPROVED' THEN
        SELECT assessment_id INTO v_assessment FROM review WHERE review_id = NEW.review_id;
        PERFORM fn_assert_approvable(NEW.claim_id, v_assessment);
    END IF;
    UPDATE claim SET claim_status = 'DECIDED' WHERE claim_id = NEW.claim_id;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_claim_decision_guard
    BEFORE INSERT ON claim_decision
    FOR EACH ROW EXECUTE FUNCTION fn_claim_decision_guard();

-- 6.7 Matches: only for a completed MATCHES_FOUND assessment created in the same transaction,
--     within top_k, against active confirmed reference cases (BR-02); at commit the ranks must be exactly 1..n (n >= 1).
CREATE FUNCTION fn_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_status  varchar(10);
    v_outcome varchar(15);
    v_top_k   integer;
    v_created timestamptz;
BEGIN
    SELECT status, outcome, top_k, created_at INTO v_status, v_outcome, v_top_k, v_created
    FROM screening_assessment WHERE assessment_id = NEW.assessment_id;
    IF v_status IS DISTINCT FROM 'COMPLETED' OR v_outcome IS DISTINCT FROM 'MATCHES_FOUND' THEN
        RAISE EXCEPTION 'matches may only be stored for a completed MATCHES_FOUND assessment'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_created IS DISTINCT FROM now() THEN
        RAISE EXCEPTION 'matches must be inserted in the same transaction as their assessment'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.match_rank > v_top_k THEN
        RAISE EXCEPTION 'match_rank % exceeds top_k %', NEW.match_rank, v_top_k
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM reference_fraud_case   -- BR-02
                   WHERE case_id = NEW.reference_case_id AND is_active AND is_confirmed) THEN
        RAISE EXCEPTION 'reference case % is not an active confirmed case', NEW.reference_case_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_match_guard
    BEFORE INSERT ON screening_match
    FOR EACH ROW EXECUTE FUNCTION fn_match_guard();

CREATE FUNCTION fn_assessment_matches_present() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_n   integer;
    v_max integer;
BEGIN
    IF NEW.outcome = 'MATCHES_FOUND' THEN
        SELECT count(*), COALESCE(max(match_rank), 0) INTO v_n, v_max
        FROM screening_match WHERE assessment_id = NEW.assessment_id;
        IF v_n = 0 THEN
            RAISE EXCEPTION 'assessment % reports MATCHES_FOUND but has no matches', NEW.assessment_id
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_n <> v_max THEN   -- ranks are unique and positive, so this means a gap
            RAISE EXCEPTION 'assessment % match ranks must be contiguous from 1', NEW.assessment_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_assessment_matches_present
    AFTER INSERT ON screening_assessment
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_assessment_matches_present();

-- ---------------------------------------------------------------------------
-- 7. Reporting views (FR-12). Plain views: authorization is enforced by the application.
--    A NULL risk_indicator means "not screened or screening failed", never "low risk".
-- ---------------------------------------------------------------------------
CREATE VIEW v_claim_status_summary AS
SELECT claim_status, screening_status, review_required, count(*) AS claim_count
FROM claim
GROUP BY claim_status, screening_status, review_required;

CREATE VIEW v_review_queue AS
SELECT c.claim_id, c.policy_id, c.claimed_amount, c.claim_status, c.screening_status,
       c.review_required, c.submitted_at,
       a.attempt_no AS latest_attempt_no, a.status AS latest_attempt_status,
       a.outcome, a.risk_indicator, a.risk_rule_version
FROM claim c
LEFT JOIN LATERAL (
    SELECT attempt_no, status, outcome, risk_indicator, risk_rule_version
    FROM screening_assessment
    WHERE claim_id = c.claim_id
    ORDER BY attempt_no DESC
    LIMIT 1
) a ON true
WHERE c.claim_status <> 'DECIDED';


-- ---------------------------------------------------------------------------
-- 8. SRS v2.0 extensions: versioned risk rules, responses, notifications,
--    database-written audit, full-text search, analytics, and recovery support.
-- ---------------------------------------------------------------------------

CREATE TABLE risk_rule (
    risk_rule_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_version       varchar(40) NOT NULL UNIQUE,
    definition         jsonb NOT NULL,
    is_active          boolean NOT NULL DEFAULT false,
    created_by         uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_risk_rule_version CHECK (btrim(rule_version) <> ''),
    CONSTRAINT ck_risk_rule_definition CHECK (
      jsonb_typeof(definition) = 'object'
      AND definition ? 'high_similarity_threshold'
      AND definition ? 'medium_similarity_threshold'
      AND (definition->>'high_similarity_threshold')::numeric BETWEEN 0 AND 1
      AND (definition->>'medium_similarity_threshold')::numeric BETWEEN 0 AND 1
      AND (definition->>'high_similarity_threshold')::numeric >= (definition->>'medium_similarity_threshold')::numeric
    )
);
CREATE UNIQUE INDEX ux_risk_rule_one_active ON risk_rule(is_active) WHERE is_active;
CREATE INDEX ix_risk_rule_created_by ON risk_rule(created_by);

-- Keep each completed screening's recorded rule version tied to a real, retained rule.
-- Added after risk_rule is created because screening_assessment is defined earlier in this file.
ALTER TABLE screening_assessment
    ADD CONSTRAINT fk_assessment_risk_rule_version
    FOREIGN KEY (risk_rule_version)
    REFERENCES risk_rule (rule_version)
    ON DELETE RESTRICT;

CREATE TABLE information_response (
    response_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id     uuid NOT NULL,
    claim_id      uuid NOT NULL REFERENCES claim(claim_id) ON DELETE RESTRICT,
    responder_id  uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
    body          text NOT NULL,
    responded_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_information_response_body CHECK (btrim(body) <> ''),
    CONSTRAINT fk_information_response_request FOREIGN KEY (review_id, claim_id)
      REFERENCES review(review_id, claim_id) ON DELETE RESTRICT
);
CREATE INDEX ix_information_response_claim_time ON information_response(claim_id, responded_at DESC);
CREATE INDEX ix_information_response_responder ON information_response(responder_id, responded_at DESC);

CREATE TABLE notification (
    notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
    claim_id        uuid REFERENCES claim(claim_id) ON DELETE RESTRICT,
    notification_type varchar(40) NOT NULL,
    message         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    read_at         timestamptz,
    dismissed_at    timestamptz,
    CONSTRAINT ck_notification_type CHECK (btrim(notification_type) <> ''),
    CONSTRAINT ck_notification_message CHECK (btrim(message) <> ''),
    CONSTRAINT ck_notification_timestamps CHECK (dismissed_at IS NULL OR read_at IS NOT NULL)
);
CREATE INDEX ix_notification_inbox ON notification(user_id, created_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX ix_notification_claim ON notification(claim_id) WHERE claim_id IS NOT NULL;

-- Retain response/notification history. Only a notification's read/dismiss state may change.
CREATE FUNCTION fn_response_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'information responses are append-only' USING ERRCODE='restrict_violation'; END $$;
CREATE TRIGGER trg_information_response_append_only BEFORE UPDATE OR DELETE ON information_response
FOR EACH ROW EXECUTE FUNCTION fn_response_append_only();
CREATE TRIGGER trg_information_response_no_truncate BEFORE TRUNCATE ON information_response
FOR EACH STATEMENT EXECUTE FUNCTION fn_forbid_mutation();
CREATE FUNCTION fn_notification_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.notification_id,NEW.user_id,NEW.claim_id,NEW.notification_type,NEW.message,NEW.created_at)
     IS DISTINCT FROM
     (OLD.notification_id,OLD.user_id,OLD.claim_id,OLD.notification_type,OLD.message,OLD.created_at) THEN
    RAISE EXCEPTION 'notification content is immutable; only read/dismiss state may change' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.dismissed_at IS NOT NULL AND NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at THEN
    RAISE EXCEPTION 'dismissed notification cannot be reopened' USING ERRCODE='restrict_violation';
  END IF;
  IF NEW.dismissed_at IS NOT NULL AND NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'notification must be marked read before dismissal' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_notification_update_guard BEFORE UPDATE ON notification
FOR EACH ROW EXECUTE FUNCTION fn_notification_update_guard();
CREATE TRIGGER trg_notification_no_delete BEFORE DELETE ON notification
FOR EACH ROW EXECUTE FUNCTION fn_forbid_mutation();
CREATE TRIGGER trg_notification_no_truncate BEFORE TRUNCATE ON notification
FOR EACH STATEMENT EXECUTE FUNCTION fn_forbid_mutation();

-- Risk computation is configurable, versioned and explainable; no undocumented threshold is
-- hard-coded. Admins seed an approved rule with thresholds appropriate to their evaluation.
CREATE FUNCTION fn_compute_claim_risk(p_assessment_id uuid, p_rule_version varchar DEFAULT NULL)
RETURNS varchar LANGUAGE plpgsql AS $$
DECLARE
  a screening_assessment%ROWTYPE;
  r risk_rule%ROWTYPE;
  v_max_similarity numeric;
  v_high numeric;
  v_medium numeric;
  v_risk varchar(10);
BEGIN
  SELECT * INTO a FROM screening_assessment WHERE assessment_id=p_assessment_id FOR UPDATE;
  IF NOT FOUND OR a.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'risk can only be computed for a completed assessment' USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO r FROM risk_rule
    WHERE (p_rule_version IS NOT NULL AND rule_version=p_rule_version)
       OR (p_rule_version IS NULL AND is_active)
    ORDER BY is_active DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no matching active risk rule' USING ERRCODE='check_violation'; END IF;
  v_high := (r.definition->>'high_similarity_threshold')::numeric;
  v_medium := (r.definition->>'medium_similarity_threshold')::numeric;
  SELECT max(similarity_score)::numeric INTO v_max_similarity
    FROM screening_match WHERE assessment_id=p_assessment_id;
  IF v_max_similarity IS NULL THEN v_risk := 'LOW';
  ELSIF v_max_similarity >= v_high THEN v_risk := 'HIGH';
  ELSIF v_max_similarity >= v_medium THEN v_risk := 'MEDIUM';
  ELSE v_risk := 'LOW'; END IF;
  -- assessment rows are immutable, so risk is written at insert time by the caller using this
  -- function's returned value, or the function can be called before matches only if rule design
  -- explicitly supports it. To preserve immutable evidence, only return the calculated result.
  RETURN v_risk;
END $$;

-- Trigger sets mandatory human-review flag from the persisted completed assessment. The rule
-- version and risk are written by the screening service; no automatic denial is performed.
CREATE FUNCTION fn_high_risk_flag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='COMPLETED' AND NEW.risk_indicator='HIGH' THEN
    UPDATE claim SET review_required=true WHERE claim_id=NEW.claim_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_high_risk_flag AFTER INSERT ON screening_assessment
FOR EACH ROW EXECUTE FUNCTION fn_high_risk_flag();

-- The following triggers record domain events transactionally. SYSTEM actor is explicit when
-- the database cannot reliably infer the authenticated principal. Applications should set
-- claimguard.actor_id locally inside each transaction for attribution.
CREATE FUNCTION fn_write_claim_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := NULLIF(current_setting('claimguard.actor_id', true),'')::uuid;
  INSERT INTO audit_log(actor_type,actor_id,action,claim_id,details)
  VALUES(CASE WHEN v_actor IS NULL THEN 'SYSTEM' ELSE 'USER' END,v_actor,'CLAIM_SUBMITTED',NEW.claim_id,
         jsonb_build_object('source','database_trigger','claim_status',NEW.claim_status));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_claim_audit AFTER INSERT ON claim FOR EACH ROW EXECUTE FUNCTION fn_write_claim_audit();

CREATE FUNCTION fn_write_assessment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor uuid; v_action varchar(40);
BEGIN
  v_actor := NULLIF(current_setting('claimguard.actor_id', true),'')::uuid;
  v_action := CASE WHEN NEW.status='FAILED' THEN 'SCREENING_FAILED' ELSE 'SCREENING_COMPLETED' END;
  INSERT INTO audit_log(actor_type,actor_id,action,claim_id,assessment_id,details)
  VALUES(CASE WHEN v_actor IS NULL THEN 'SYSTEM' ELSE 'USER' END,v_actor,v_action,NEW.claim_id,NEW.assessment_id,
         jsonb_build_object('source','database_trigger','attempt_no',NEW.attempt_no,'status',NEW.status));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assessment_audit AFTER INSERT ON screening_assessment FOR EACH ROW EXECUTE FUNCTION fn_write_assessment_audit();

CREATE FUNCTION fn_write_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(actor_type,actor_id,action,claim_id,assessment_id,details)
  VALUES('USER',NEW.reviewer_id,'REVIEW_RECORDED',NEW.claim_id,NEW.assessment_id,
         jsonb_build_object('source','database_trigger','review_id',NEW.review_id,'review_action',NEW.review_action));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_review_audit AFTER INSERT ON review FOR EACH ROW EXECUTE FUNCTION fn_write_review_audit();

CREATE FUNCTION fn_write_decision_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_reviewer uuid; v_assessment uuid;
BEGIN
  SELECT reviewer_id,assessment_id INTO v_reviewer,v_assessment FROM review WHERE review_id=NEW.review_id;
  INSERT INTO audit_log(actor_type,actor_id,action,claim_id,assessment_id,details)
  VALUES('USER',v_reviewer,'DECISION_RECORDED',NEW.claim_id,v_assessment,
         jsonb_build_object('source','database_trigger','decision_id',NEW.decision_id,'decision_status',NEW.decision_status));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_decision_audit AFTER INSERT ON claim_decision FOR EACH ROW EXECUTE FUNCTION fn_write_decision_audit();

CREATE FUNCTION fn_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := NULLIF(current_setting('claimguard.actor_id', true),'')::uuid;
  INSERT INTO audit_log(actor_type,actor_id,action,target_user_id,details)
  VALUES(CASE WHEN v_actor IS NULL THEN 'SYSTEM' ELSE 'USER' END,v_actor,'POLICY_ISSUED',NEW.holder_id,
         jsonb_build_object('source','policy_issuance_trigger','policy_id',NEW.policy_id,'policy_number',NEW.policy_number));
  RETURN NEW;
END $$;
-- Policy issuance is audited as a target-user event because the base audit table scopes one target.
CREATE TRIGGER trg_policy_issuance_audit AFTER INSERT ON policy FOR EACH ROW EXECUTE FUNCTION fn_policy_audit();

CREATE FUNCTION fn_response_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(actor_type,actor_id,action,claim_id,details)
  VALUES('USER',NEW.responder_id,'INFORMATION_RESPONSE_ADDED',NEW.claim_id,
         jsonb_build_object('source','database_trigger','response_id',NEW.response_id,'review_id',NEW.review_id));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_information_response_audit AFTER INSERT ON information_response FOR EACH ROW EXECUTE FUNCTION fn_response_audit();

CREATE FUNCTION fn_notification_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.dismissed_at IS NULL AND NEW.dismissed_at IS NOT NULL THEN
    INSERT INTO audit_log(actor_type,actor_id,action,target_user_id,details)
    VALUES('SYSTEM',NULL,'NOTIFICATION_DISMISSED',NEW.user_id,
           jsonb_build_object('source','database_trigger','notification_id',NEW.notification_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_notification_audit AFTER UPDATE ON notification FOR EACH ROW EXECUTE FUNCTION fn_notification_audit();

-- Full-text keyword search; rank is relevance, not fraud probability.
CREATE INDEX ix_claim_description_fts ON claim USING gin (to_tsvector('english', description));
CREATE VIEW v_risk_distribution_over_time AS
SELECT date_trunc('day', a.created_at)::date AS assessment_day, a.risk_indicator,
       count(*) AS assessment_count
FROM screening_assessment a WHERE a.status='COMPLETED'
GROUP BY date_trunc('day', a.created_at)::date, a.risk_indicator;
CREATE VIEW v_reference_match_frequency AS
SELECT r.case_id, r.title, count(*) AS match_count, avg(m.similarity_score) AS average_similarity
FROM reference_fraud_case r JOIN screening_match m ON m.reference_case_id=r.case_id
GROUP BY r.case_id, r.title;
CREATE VIEW v_adjuster_workload AS
SELECT reviewer_id, count(*) AS review_count,
       count(*) FILTER (WHERE review_action='APPROVED') AS approvals,
       count(*) FILTER (WHERE review_action='REJECTED') AS rejections,
       count(*) FILTER (WHERE review_action='INFO_REQUESTED') AS information_requests
FROM review GROUP BY reviewer_id;
CREATE VIEW v_high_risk_aged_queue AS
SELECT claim_id, policy_id, claimed_amount, submitted_at,
       floor(extract(epoch FROM (now()-submitted_at))/3600)::bigint AS age_hours
FROM claim WHERE review_required AND claim_status <> 'DECIDED';

-- Safe stale-work discovery; retry execution is bounded by application policy and attempt_no.
CREATE VIEW v_stale_pending_screening AS
SELECT c.claim_id, c.submitted_at, max(a.created_at) AS last_attempt_at,
       coalesce(max(a.attempt_no),0) AS last_attempt_no
FROM claim c LEFT JOIN screening_assessment a ON a.claim_id=c.claim_id
WHERE c.screening_status='PENDING'
GROUP BY c.claim_id,c.submitted_at
HAVING coalesce(max(a.created_at),c.submitted_at) < now()-interval '15 minutes';

COMMIT;
