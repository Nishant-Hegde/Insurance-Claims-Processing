-- Migration 004: workflow rules enforced in the database.
-- Apply after 003_reference_case_versioning.sql:
--   psql -v ON_ERROR_STOP=1 -d <db> -f database/migrations/004_workflow_guards.sql
--
--   1. Information responses: only the claim's own policyholder may answer, and only the
--      claim's latest, still-unanswered INFO_REQUESTED review (closes SRS FR-18 gap).
--      Answering moves the claim back to UNDER_REVIEW and notifies the requesting adjuster.
--   2. HIGH-risk approval: a claim flagged review_required can only be APPROVED after an
--      information request was made AND every request on it has been answered
--      (defines "review started and resolved", closes the FR-08/09 gap). Added to
--      fn_assert_approvable, so trg_review_guard and trg_claim_decision_guard both apply it.
--   3. User activation: USER_STATUS_CHANGED audit row, and the last active ADMIN cannot
--      be deactivated (nobody could administer the system afterwards).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Information responses
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_information_response_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_claimant uuid;
    v_status   varchar(20);
    v_latest   uuid;
    v_action   varchar(15);
BEGIN
    -- Lock the claim so two responses (or a response and a decision) cannot interleave.
    SELECT claimant_id, claim_status INTO v_claimant, v_status
    FROM claim WHERE claim_id = NEW.claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NEW;   -- reported by the foreign key
    END IF;
    IF NEW.responder_id IS DISTINCT FROM v_claimant THEN
        RAISE EXCEPTION 'only the policyholder who submitted this claim can respond to its information request'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT review_id, review_action INTO v_latest, v_action
    FROM   review
    WHERE  claim_id = NEW.claim_id
    ORDER  BY reviewed_at DESC, review_id DESC
    LIMIT  1;
    IF v_action IS DISTINCT FROM 'INFO_REQUESTED' OR v_latest IS DISTINCT FROM NEW.review_id THEN
        RAISE EXCEPTION 'there is no outstanding information request to answer on this claim'
            USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM information_response WHERE review_id = NEW.review_id) THEN
        RAISE EXCEPTION 'this information request has already been answered'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_status <> 'AWAITING_INFO' THEN
        RAISE EXCEPTION 'claim is % and is not waiting for information', v_status
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.responded_at := now();   -- server time, cannot be backdated
    RETURN NEW;
END $$;

CREATE TRIGGER trg_information_response_guard
    BEFORE INSERT ON information_response
    FOR EACH ROW EXECUTE FUNCTION fn_information_response_guard();

CREATE FUNCTION fn_information_response_followup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_reviewer uuid;
BEGIN
    -- AWAITING_INFO -> UNDER_REVIEW is an allowed transition (fn_claim_state_guard).
    UPDATE claim SET claim_status = 'UNDER_REVIEW'
    WHERE  claim_id = NEW.claim_id AND claim_status = 'AWAITING_INFO';

    SELECT reviewer_id INTO v_reviewer FROM review WHERE review_id = NEW.review_id;
    INSERT INTO notification (user_id, claim_id, notification_type, message)
    VALUES (v_reviewer, NEW.claim_id, 'INFO_RECEIVED',
            'The policyholder answered your information request for claim CL-'
            || upper(right(NEW.claim_id::text, 8)) || '.');
    RETURN NEW;
END $$;

CREATE TRIGGER trg_information_response_followup
    AFTER INSERT ON information_response
    FOR EACH ROW EXECUTE FUNCTION fn_information_response_followup();

-- ---------------------------------------------------------------------------
-- 2. HIGH-risk approval rule, added to the existing approval guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_assert_approvable(p_claim uuid, p_assessment uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_screening       varchar(10);
    v_review_required boolean;
    v_basis           varchar(10);
BEGIN
    -- Unchanged from schema v4: screening must be COMPLETED and the review must have
    -- examined a completed assessment of this claim.
    SELECT screening_status, review_required INTO v_screening, v_review_required
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

    -- New (migration 004): HIGH-risk claims need a resolved information request first.
    IF v_review_required THEN
        IF NOT EXISTS (SELECT 1 FROM review
                       WHERE claim_id = p_claim AND review_action = 'INFO_REQUESTED') THEN
            RAISE EXCEPTION 'approval blocked: HIGH-risk claim needs an information request answered by the policyholder before approval'
                USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM review r
                   WHERE r.claim_id = p_claim AND r.review_action = 'INFO_REQUESTED'
                     AND NOT EXISTS (SELECT 1 FROM information_response ir
                                     WHERE ir.review_id = r.review_id)) THEN
            RAISE EXCEPTION 'approval blocked: an information request on this HIGH-risk claim is still unanswered'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. User activation
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_user_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_active AND NOT NEW.is_active
       AND EXISTS (SELECT 1 FROM app_role WHERE role_id = OLD.role_id AND role_name = 'ADMIN')
       AND NOT EXISTS (SELECT 1 FROM app_user u JOIN app_role r USING (role_id)
                       WHERE r.role_name = 'ADMIN' AND u.is_active AND u.user_id <> OLD.user_id) THEN
        RAISE EXCEPTION 'the last active administrator cannot be deactivated'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_user_status_guard
    BEFORE UPDATE OF is_active ON app_user
    FOR EACH ROW EXECUTE FUNCTION fn_user_status_guard();

CREATE FUNCTION fn_user_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_actor uuid;
BEGIN
    v_actor := NULLIF(current_setting('claimguard.actor_id', true), '')::uuid;
    INSERT INTO audit_log (actor_type, actor_id, action, target_user_id, details)
    VALUES (CASE WHEN v_actor IS NULL THEN 'SYSTEM' ELSE 'USER' END, v_actor,
            'USER_STATUS_CHANGED', NEW.user_id,
            jsonb_build_object('source', 'database_trigger', 'is_active', NEW.is_active));
    RETURN NEW;
END $$;

-- Fires after trg_user_deactivate_revoke_sessions (migration 001) has revoked sessions.
CREATE TRIGGER trg_user_status_audit
    AFTER UPDATE OF is_active ON app_user
    FOR EACH ROW WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
    EXECUTE FUNCTION fn_user_status_audit();

COMMIT;
