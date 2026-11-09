-- #############################################################################
-- ##                                                                         ##
-- ##   WARNING: DESTRUCTIVE. FOR DISPOSABLE DEVELOPMENT DATABASES ONLY.      ##
-- ##                                                                         ##
-- ##   This script DROPS every ClaimGuard table, view, procedure and         ##
-- ##   function, and ALL DATA IN THEM. There is no undo.                     ##
-- ##   Never run it against a shared, graded, staging or production DB.      ##
-- ##                                                                         ##
-- #############################################################################
--
-- Usage (from the repository root, against a throwaway database):
--   psql -v ON_ERROR_STOP=1 -d claimguard_demo_xxx -f database/scripts/reset_db.sql
-- Then rebuild in order: schema v4 -> seed -> migration 001 -> demo passwords -> migration 002.
--
-- Safety guard: the script refuses to run unless the current database name contains
-- "demo", "dev", "test" or "scratch". Everything runs in ONE transaction, so if the guard
-- fails nothing is dropped (even when psql is not using ON_ERROR_STOP).
--
-- Why explicit DROPs instead of DROP SCHEMA public CASCADE:
--   This file shows the dependency order by hand. Objects that depend on others go first:
--   views -> procedures -> child tables -> parent tables -> trigger/helper functions.
--   No CASCADE is used, so if a new object is ever added and forgotten here, the DROP
--   of its parent fails loudly instead of silently removing it.
--   The one-line alternative (also wipes anything else in "public"):
--     DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;
BEGIN;

DO $$
BEGIN
    IF current_database() !~* '(demo|dev|test|scratch)' THEN
        RAISE EXCEPTION 'reset_db.sql refused: database "%" does not look disposable', current_database()
            USING HINT = 'Use a database whose name contains demo, dev, test or scratch.';
    END IF;
    RAISE NOTICE 'reset_db.sql: dropping ClaimGuard objects in database "%"', current_database();
END $$;

-- 1. Views (depend on tables)
DROP VIEW IF EXISTS v_active_session;
DROP VIEW IF EXISTS v_stale_pending_screening;
DROP VIEW IF EXISTS v_high_risk_aged_queue;
DROP VIEW IF EXISTS v_adjuster_workload;
DROP VIEW IF EXISTS v_reference_match_frequency;
DROP VIEW IF EXISTS v_risk_distribution_over_time;
DROP VIEW IF EXISTS v_review_queue;
DROP VIEW IF EXISTS v_claim_status_summary;

-- 2. Procedures (migrations 002 and 003)
DROP PROCEDURE IF EXISTS sp_revise_reference_case(uuid, uuid, varchar, text, integer, vector, uuid);
DROP PROCEDURE IF EXISTS sp_decide_claim(uuid, uuid, varchar, text, uuid, uuid, uuid);
DROP PROCEDURE IF EXISTS sp_screen_claim(uuid, integer, vector, integer, text, uuid, varchar, varchar);

-- 3. Tables, children before parents (each DROP TABLE also drops its own triggers,
--    indexes and constraints).
DROP TABLE IF EXISTS user_session;          -- -> app_user
DROP TABLE IF EXISTS notification;          -- -> app_user, claim
DROP TABLE IF EXISTS information_response;  -- -> review, claim, app_user
DROP TABLE IF EXISTS claim_decision;        -- -> review
DROP TABLE IF EXISTS audit_log;             -- -> screening_assessment, claim, reference_fraud_case, app_user
DROP TABLE IF EXISTS screening_match;       -- -> screening_assessment, reference_fraud_case
DROP TABLE IF EXISTS review;                -- -> screening_assessment, claim, app_user
DROP TABLE IF EXISTS screening_assessment;  -- -> claim, embedding_model, risk_rule
DROP TABLE IF EXISTS risk_rule;             -- -> app_user
DROP TABLE IF EXISTS claim;                 -- -> policy
DROP TABLE IF EXISTS reference_fraud_case;  -- -> embedding_model, app_user
DROP TABLE IF EXISTS policy;                -- -> app_user
DROP TABLE IF EXISTS embedding_model;
DROP TABLE IF EXISTS app_user;              -- -> app_role
DROP TABLE IF EXISTS app_role;

-- 4. Functions (trigger functions are only droppable once their triggers are gone)
DROP FUNCTION IF EXISTS fn_session_principal(char);
DROP FUNCTION IF EXISTS fn_user_has_role(uuid, text[]);
DROP FUNCTION IF EXISTS fn_session_insert_guard();
DROP FUNCTION IF EXISTS fn_session_update_guard();
DROP FUNCTION IF EXISTS fn_revoke_sessions_on_deactivate();
DROP FUNCTION IF EXISTS fn_compute_claim_risk(uuid, varchar);
DROP FUNCTION IF EXISTS fn_assert_approvable(uuid, uuid);
DROP FUNCTION IF EXISTS fn_require_role();
DROP FUNCTION IF EXISTS fn_user_role_change_guard();
DROP FUNCTION IF EXISTS fn_forbid_mutation();
DROP FUNCTION IF EXISTS fn_claim_insert_guard();
DROP FUNCTION IF EXISTS fn_claim_core_immutable();
DROP FUNCTION IF EXISTS fn_claim_state_guard();
DROP FUNCTION IF EXISTS fn_ref_case_immutable();
DROP FUNCTION IF EXISTS fn_assessment_before_insert();
DROP FUNCTION IF EXISTS fn_assessment_sync_claim();
DROP FUNCTION IF EXISTS fn_review_guard();
DROP FUNCTION IF EXISTS fn_claim_decision_guard();
DROP FUNCTION IF EXISTS fn_match_guard();
DROP FUNCTION IF EXISTS fn_assessment_matches_present();
DROP FUNCTION IF EXISTS fn_response_append_only();
DROP FUNCTION IF EXISTS fn_notification_update_guard();
DROP FUNCTION IF EXISTS fn_high_risk_flag();
DROP FUNCTION IF EXISTS fn_write_claim_audit();
DROP FUNCTION IF EXISTS fn_write_assessment_audit();
DROP FUNCTION IF EXISTS fn_write_review_audit();
DROP FUNCTION IF EXISTS fn_write_decision_audit();
DROP FUNCTION IF EXISTS fn_policy_audit();
DROP FUNCTION IF EXISTS fn_response_audit();
DROP FUNCTION IF EXISTS fn_notification_audit();
DROP FUNCTION IF EXISTS fn_ref_case_lineage_immutable();   -- migration 003
DROP FUNCTION IF EXISTS fn_ref_case_supersede_check();     -- migration 003
DROP FUNCTION IF EXISTS fn_ref_case_audit();               -- migration 003
DROP FUNCTION IF EXISTS fn_information_response_guard();    -- migration 004
DROP FUNCTION IF EXISTS fn_information_response_followup(); -- migration 004
DROP FUNCTION IF EXISTS fn_user_status_guard();             -- migration 004
DROP FUNCTION IF EXISTS fn_user_status_audit();             -- migration 004
DROP FUNCTION IF EXISTS _seed_vec(integer);   -- seed helper, left behind if a seed run failed

-- The pgvector extension is kept on purpose: re-creating it may need superuser rights,
-- and the schema uses CREATE EXTENSION IF NOT EXISTS. To remove it too:
--   DROP EXTENSION IF EXISTS vector;

-- 5. Proof: nothing ClaimGuard-owned is left in "public".
DO $$
DECLARE
    v_left integer;
BEGIN
    SELECT count(*) INTO v_left
    FROM   pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'S');
    RAISE NOTICE 'reset_db.sql: % tables/views/sequences remain in public', v_left;
END $$;

COMMIT;
