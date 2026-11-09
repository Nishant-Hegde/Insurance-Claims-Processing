-- Migration 002: bind screenings to risk-rule versions, and add two transactional procedures.
-- Apply after 001_user_session_auth.sql (and after the seed / demo passwords, if used):
--   psql -v ON_ERROR_STOP=1 -d <db> -f database/migrations/002_risk_rule_fk_and_procedure.sql
--
-- What this adds
--   1. FK screening_assessment.risk_rule_version -> risk_rule.rule_version (closes the
--      documented "risk_rule not FK-bound" gap).
--   2. sp_screen_claim  : one atomic screening attempt (assessment + matches + risk).
--   3. sp_decide_claim  : one atomic adjuster action (review + decision + notification).
--
-- Both procedures do NOT commit themselves. They run inside the caller's transaction, so
--   CALL ...;                      -> its own transaction (autocommit)
--   BEGIN; CALL ...; COMMIT;       -> everything kept
--   BEGIN; CALL ...; ROLLBACK;     -> everything discarded, including trigger-written audit rows
-- Any error raised inside a procedure aborts the whole statement: nothing is half-written.
--
-- Requires PostgreSQL 13+ (INOUT procedure parameters, CALL) and pgvector.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Foreign key: screening_assessment.risk_rule_version -> risk_rule.rule_version
-- ---------------------------------------------------------------------------
-- Rows to fix first: any assessment naming a rule version that does not exist.
-- screening_assessment is append-only (trg_screening_assessment_append_only), so a bad row
-- cannot simply be UPDATEd. We therefore stop with a clear list instead of silently
-- disabling the history guard. The shipped seed only uses 'v1.1', which exists.
DO $$
DECLARE
    v_bad text;
BEGIN
    SELECT string_agg(DISTINCT a.risk_rule_version, ', ') INTO v_bad
    FROM   screening_assessment a
    WHERE  a.risk_rule_version IS NOT NULL
      AND  NOT EXISTS (SELECT 1 FROM risk_rule r WHERE r.rule_version = a.risk_rule_version);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'cannot add FK: screening_assessment uses unknown risk_rule versions: %', v_bad
            USING HINT = 'Insert the missing risk_rule rows (is_active = false) first, then re-run.';
    END IF;
END $$;

-- Newer copies of claimguard_schema_v4.sql (v4.1) already declare this FK. Older databases
-- do not. Add it only if no FK on that column exists, so the migration is safe on both.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint con
        JOIN   pg_attribute att
               ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
        WHERE  con.conrelid = 'screening_assessment'::regclass
          AND  con.contype  = 'f'
          AND  con.confrelid = 'risk_rule'::regclass
          AND  att.attname  = 'risk_rule_version'
    ) THEN
        ALTER TABLE screening_assessment
            ADD CONSTRAINT fk_assessment_risk_rule_version
            FOREIGN KEY (risk_rule_version)
            REFERENCES risk_rule (rule_version)
            ON UPDATE RESTRICT       -- a published rule version can never be renamed
            ON DELETE RESTRICT;      -- or deleted while a screening refers to it
        RAISE NOTICE 'migration 002: added fk_assessment_risk_rule_version';
    ELSE
        RAISE NOTICE 'migration 002: risk_rule_version FK already present, left unchanged';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. sp_screen_claim: record one screening attempt for a claim, all-or-nothing.
-- ---------------------------------------------------------------------------
-- Inputs
--   p_claim_id            claim to screen
--   p_embedding_model_id  model that produced p_query_embedding
--   p_query_embedding     the claim description's embedding (computed by the app's model)
--   p_top_k               how many nearest reference cases to keep (1..1000)
--   p_failure_reason      set by the caller when the embedding service itself failed;
--                         records a FAILED attempt with this reason
-- Outputs (INOUT, may be omitted in CALL)
--   p_assessment_id, p_status ('COMPLETED' | 'FAILED'), p_risk_indicator (NULL when FAILED)
--
-- Why risk is computed before the INSERT:
--   screening_assessment is append-only and ck_assessment_completed requires risk_indicator
--   and risk_rule_version at insert time; trg_high_risk_flag also reads NEW.risk_indicator.
--   So the procedure ranks candidates first, applies the locked active rule, inserts the
--   assessment and its matches, then calls fn_compute_claim_risk on the stored rows as an
--   independent check. If the two answers ever differ, the whole attempt is rolled back.
--
-- Failure safety: any error while computing a COMPLETED result (no active rule, wrong vector
-- dimension, zero vector, unknown model, ...) is caught, the partial work is undone, and a
-- FAILED attempt is stored with the error text. A failed screening is never stored as LOW.
-- Caller errors (unknown claim, decided claim, already screened claim) are raised, not stored.
CREATE OR REPLACE PROCEDURE sp_screen_claim(
    p_claim_id            uuid,
    p_embedding_model_id  integer,
    p_query_embedding     vector,
    p_top_k               integer DEFAULT 3,
    p_failure_reason      text    DEFAULT NULL,
    INOUT p_assessment_id  uuid    DEFAULT NULL,
    INOUT p_status         varchar DEFAULT NULL,
    INOUT p_risk_indicator varchar DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_claim_status  varchar(20);
    v_screening     varchar(10);
    v_attempt_no    integer;
    v_rule_version  varchar(40);
    v_high          numeric;
    v_medium        numeric;
    v_max_sim       numeric;
    v_n_matches     integer;
    v_outcome       varchar(15);
    v_risk          varchar(30);
    v_check         varchar(30);
    v_reason        text;
BEGIN
    p_assessment_id  := NULL;
    p_status         := NULL;
    p_risk_indicator := NULL;

    -- Serialize attempts on this claim (same lock the BEFORE INSERT trigger takes).
    SELECT claim_status, screening_status INTO v_claim_status, v_screening
    FROM   claim WHERE claim_id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'claim % does not exist', p_claim_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_claim_status = 'DECIDED' THEN
        RAISE EXCEPTION 'claim % is already decided', p_claim_id USING ERRCODE = 'check_violation';
    END IF;
    IF v_screening = 'COMPLETED' THEN
        RAISE EXCEPTION 'claim % already has a completed screening', p_claim_id
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT coalesce(max(attempt_no), 0) + 1 INTO v_attempt_no
    FROM   screening_assessment WHERE claim_id = p_claim_id;

    v_reason := nullif(btrim(p_failure_reason), '');
    IF v_reason IS NULL AND p_query_embedding IS NULL THEN
        v_reason := 'no description embedding supplied';
    END IF;

    IF v_reason IS NULL THEN
        BEGIN   -- sub-block = savepoint: an error here undoes only this block
            IF p_top_k IS NULL OR p_top_k < 1 OR p_top_k > 1000 THEN
                RAISE EXCEPTION 'top_k must be between 1 and 1000 (got %)', p_top_k;
            END IF;

            -- Lock the active rule so it cannot be switched while this attempt is recorded.
            SELECT rule_version,
                   (definition->>'high_similarity_threshold')::numeric,
                   (definition->>'medium_similarity_threshold')::numeric
              INTO v_rule_version, v_high, v_medium
            FROM   risk_rule WHERE is_active FOR SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'no active risk rule';
            END IF;

            -- HNSW returns at most hnsw.ef_search rows; raise it for this transaction if needed.
            IF p_top_k > 40 THEN
                PERFORM set_config('hnsw.ef_search', p_top_k::text, true);
            END IF;

            -- Top-k nearest active + confirmed reference cases from the same embedding model.
            -- Same shape as the query documented next to ix_ref_case_embedding_hnsw.
            CREATE TEMP TABLE IF NOT EXISTS _sp_screen_candidates (
                match_rank        integer,
                reference_case_id uuid,
                similarity_score  double precision
            ) ON COMMIT DROP;
            TRUNCATE _sp_screen_candidates;

            INSERT INTO _sp_screen_candidates (match_rank, reference_case_id, similarity_score)
            SELECT row_number() OVER (ORDER BY dist, case_id)::integer,
                   case_id,
                   1 - dist                         -- similarity = 1 - cosine distance
            FROM (
                SELECT r.case_id, r.embedding <=> p_query_embedding AS dist
                FROM   reference_fraud_case r
                WHERE  r.is_active AND r.is_confirmed
                  AND  r.embedding_model_id = p_embedding_model_id
                ORDER  BY r.embedding <=> p_query_embedding
                LIMIT  p_top_k
            ) nn;

            SELECT count(*), max(similarity_score)::numeric INTO v_n_matches, v_max_sim
            FROM   _sp_screen_candidates;

            v_outcome := CASE WHEN v_n_matches > 0 THEN 'MATCHES_FOUND' ELSE 'NO_MATCH' END;
            -- Same thresholds and comparison as fn_compute_claim_risk.
            v_risk := CASE WHEN v_max_sim IS NULL     THEN 'LOW'
                           WHEN v_max_sim >= v_high   THEN 'HIGH'
                           WHEN v_max_sim >= v_medium THEN 'MEDIUM'
                           ELSE 'LOW' END;

            -- Triggers fire here: trg_assessment_before_insert (lock + created_at),
            -- trg_assessment_sync_claim (claim.screening_status), trg_high_risk_flag
            -- (review_required on HIGH), trg_assessment_audit (SCREENING_COMPLETED row).
            INSERT INTO screening_assessment
                (claim_id, attempt_no, status, outcome, risk_indicator, risk_rule_version,
                 embedding_model_id, description_embedding, top_k, similarity_metric, failure_reason)
            VALUES
                (p_claim_id, v_attempt_no, 'COMPLETED', v_outcome, v_risk, v_rule_version,
                 p_embedding_model_id, p_query_embedding, p_top_k, 'cosine_similarity', NULL)
            RETURNING assessment_id INTO p_assessment_id;

            -- trg_match_guard checks: same transaction, rank <= top_k, case active+confirmed.
            INSERT INTO screening_match
                (assessment_id, reference_case_id, embedding_model_id, match_rank, similarity_score)
            SELECT p_assessment_id, reference_case_id, p_embedding_model_id, match_rank, similarity_score
            FROM   _sp_screen_candidates
            ORDER  BY match_rank;

            -- Independent check with the schema's own risk function on the persisted matches.
            v_check := fn_compute_claim_risk(p_assessment_id, v_rule_version);
            IF v_check IS DISTINCT FROM v_risk THEN
                RAISE EXCEPTION 'risk mismatch: stored %, fn_compute_claim_risk %', v_risk, v_check;
            END IF;

            p_status         := 'COMPLETED';
            p_risk_indicator := v_risk;
        EXCEPTION WHEN OTHERS THEN
            -- Everything in the block (assessment, matches, audit row, claim flag) is undone.
            v_reason := left('screening error: ' || SQLERRM, 1000);
            p_assessment_id := NULL;
        END;
    END IF;

    IF v_reason IS NOT NULL THEN
        -- FAILED attempt: no outcome, no risk, no rule version (ck_assessment_failed).
        -- trg_assessment_sync_claim sets claim.screening_status = 'FAILED';
        -- trg_assessment_audit writes SCREENING_FAILED.
        INSERT INTO screening_assessment
            (claim_id, attempt_no, status, outcome, risk_indicator, risk_rule_version,
             embedding_model_id, description_embedding, top_k, similarity_metric, failure_reason)
        VALUES
            (p_claim_id, v_attempt_no, 'FAILED', NULL, NULL, NULL,
             NULL, NULL, NULL, NULL, v_reason)
        RETURNING assessment_id INTO p_assessment_id;
        p_status         := 'FAILED';
        p_risk_indicator := NULL;    -- never LOW
    END IF;
END $$;

COMMENT ON PROCEDURE sp_screen_claim(uuid, integer, vector, integer, text, uuid, varchar, varchar) IS
    'Atomic screening attempt: next attempt_no, top-k cosine matches, risk from the locked active rule '
    '(cross-checked by fn_compute_claim_risk). Errors become a FAILED attempt, never LOW.';

-- ---------------------------------------------------------------------------
-- 3. sp_decide_claim: one adjuster action on a claim, all-or-nothing.
-- ---------------------------------------------------------------------------
-- p_action: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED'
--   * locks the claim and refuses decided claims
--   * moves SUBMITTED -> UNDER_REVIEW (allowed transition) before any review
--   * INFO_REQUESTED moves the claim to AWAITING_INFO
--   * links the review to the claim's latest screening attempt (evidence examined)
--   * APPROVED calls fn_assert_approvable first (screening must be COMPLETED);
--     trg_review_guard and trg_claim_decision_guard check it again (defence in depth)
--   * APPROVED / REJECTED also insert claim_decision (trigger sets claim_status = DECIDED)
--   * notifies the policyholder
-- Audit rows are written by trg_review_audit and trg_decision_audit inside the same
-- transaction, so a failure anywhere leaves no review, no decision, no notification and
-- no audit row behind.
CREATE OR REPLACE PROCEDURE sp_decide_claim(
    p_claim_id     uuid,
    p_reviewer_id  uuid,
    p_action       varchar,
    p_notes        text,
    INOUT p_review_id       uuid DEFAULT NULL,
    INOUT p_decision_id     uuid DEFAULT NULL,
    INOUT p_notification_id uuid DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_claim       claim%ROWTYPE;
    v_assessment  uuid;
    v_policy_no   varchar(40);
    v_type        varchar(40);
    v_message     text;
BEGIN
    p_review_id := NULL;  p_decision_id := NULL;  p_notification_id := NULL;

    IF p_action IS NULL OR p_action NOT IN ('APPROVED', 'REJECTED', 'INFO_REQUESTED') THEN
        RAISE EXCEPTION 'invalid action %: expected APPROVED, REJECTED or INFO_REQUESTED', p_action
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_claim FROM claim WHERE claim_id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'claim % does not exist', p_claim_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_claim.claim_status = 'DECIDED' THEN
        RAISE EXCEPTION 'claim % is already decided', p_claim_id USING ERRCODE = 'check_violation';
    END IF;

    -- Evidence the adjuster examined: the latest screening attempt (may be none).
    SELECT assessment_id INTO v_assessment
    FROM   screening_assessment
    WHERE  claim_id = p_claim_id
    ORDER  BY attempt_no DESC
    LIMIT  1;

    IF p_action = 'APPROVED' THEN
        PERFORM fn_assert_approvable(p_claim_id, v_assessment);
    END IF;

    -- A review starts the review stage (fn_claim_state_guard allows SUBMITTED -> UNDER_REVIEW).
    IF v_claim.claim_status = 'SUBMITTED' AND p_action <> 'INFO_REQUESTED' THEN
        UPDATE claim SET claim_status = 'UNDER_REVIEW' WHERE claim_id = p_claim_id;
    END IF;

    -- trg_review_reviewer_role: reviewer must be an active CLAIMS_ADJUSTER.
    -- trg_review_guard: not decided; APPROVED re-checks fn_assert_approvable.
    -- trg_review_audit: writes REVIEW_RECORDED.
    INSERT INTO review (claim_id, assessment_id, reviewer_id, review_action, notes)
    VALUES (p_claim_id, v_assessment, p_reviewer_id, p_action, p_notes)
    RETURNING review_id INTO p_review_id;

    SELECT policy_number INTO v_policy_no FROM policy WHERE policy_id = v_claim.policy_id;

    IF p_action IN ('APPROVED', 'REJECTED') THEN
        -- trg_claim_decision_guard: sets claim_status = DECIDED; trg_decision_audit: DECISION_RECORDED.
        INSERT INTO claim_decision (claim_id, review_id, decision_status)
        VALUES (p_claim_id, p_review_id, p_action)
        RETURNING decision_id INTO p_decision_id;

        v_type    := 'CLAIM_' || p_action;
        v_message := format('Your claim under policy %s has been %s.',
                            v_policy_no, lower(p_action));
    ELSE
        IF v_claim.claim_status <> 'AWAITING_INFO' THEN
            UPDATE claim SET claim_status = 'AWAITING_INFO' WHERE claim_id = p_claim_id;
        END IF;
        v_type    := 'INFO_REQUESTED';
        v_message := format('Additional information has been requested for your claim under policy %s.',
                            v_policy_no);
    END IF;

    INSERT INTO notification (user_id, claim_id, notification_type, message)
    VALUES (v_claim.claimant_id, p_claim_id, v_type, v_message)
    RETURNING notification_id INTO p_notification_id;
END $$;

COMMENT ON PROCEDURE sp_decide_claim(uuid, uuid, varchar, text, uuid, uuid, uuid) IS
    'Atomic adjuster action: review (+ claim_decision for APPROVED/REJECTED) + policyholder notification. '
    'Any failure rolls back everything, including trigger-written audit rows.';

COMMIT;
