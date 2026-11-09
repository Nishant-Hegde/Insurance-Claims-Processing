-- Migration 005: PostgreSQL roles and privileges (role-based access control in the database).
-- Apply after 004_workflow_guards.sql, as the database owner:
--   psql -v ON_ERROR_STOP=1 -d <db> -f database/migrations/005_db_roles.sql
--
-- Two group roles (NOLOGIN; no passwords in this repository):
--   claimguard_app       what the web application needs and nothing more:
--                        read/insert/update on the tables it uses, no DELETE (except expired or
--                        revoked sessions), no TRUNCATE, no DDL, EXECUTE on the procedures.
--   claimguard_readonly  reporting access: the reporting views only, no base tables.
--
-- To make the web app use it, create a login role that inherits claimguard_app and point
-- DATABASE_URL at it (choose your own password; never commit it):
--   CREATE ROLE claimguard_web LOGIN PASSWORD '<password>' IN ROLE claimguard_app;
--
-- This sits on top of the application-level roles (app_role / app_user), which the triggers
-- already enforce: e.g. only an active CLAIMS_ADJUSTER can insert a review. Database roles add a
-- second layer: even a bug or an injected query running as claimguard_app cannot delete claims,
-- rewrite the audit log, truncate a table or change the schema.
--
-- Roles are cluster-wide, so they are created only if missing. Privileges are per-database
-- and disappear with the objects when reset_db.sql drops them; re-apply this file afterwards.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claimguard_app') THEN
        CREATE ROLE claimguard_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claimguard_readonly') THEN
        CREATE ROLE claimguard_readonly NOLOGIN;
    END IF;
END $$;

-- Nobody but the owner creates objects in public (already the default since PostgreSQL 15).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO claimguard_app, claimguard_readonly;

-- ---------------------------------------------------------------------------
-- claimguard_app
-- ---------------------------------------------------------------------------
-- Reference data and records the app reads and changes. UPDATE is also what allows the
-- SELECT ... FOR UPDATE / FOR SHARE row locks taken by the procedures and guards; the
-- immutability and state-machine triggers still decide which updates are allowed.
GRANT SELECT, INSERT, UPDATE ON
    app_user, policy, claim, embedding_model, reference_fraud_case, risk_rule,
    screening_assessment, notification
TO claimguard_app;
GRANT SELECT ON app_role TO claimguard_app;

-- Append-only history: read and add, never change or delete.
GRANT SELECT, INSERT ON
    screening_match, review, information_response, claim_decision, audit_log
TO claimguard_app;

-- Sessions: sign-in, sign-out (revocation) and housekeeping of dead sessions.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_session TO claimguard_app;

-- Identity columns (embedding_model, risk_rule, screening_match, audit_log).
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO claimguard_app;

-- Views, functions and procedures the app calls. Procedures are EXECUTE-able by PUBLIC by
-- default; restrict them to the app role.
REVOKE EXECUTE ON PROCEDURE
    sp_screen_claim(uuid, integer, vector, integer, text, uuid, varchar, varchar),
    sp_decide_claim(uuid, uuid, varchar, text, uuid, uuid, uuid),
    sp_revise_reference_case(uuid, uuid, varchar, text, integer, vector, uuid)
FROM PUBLIC;
GRANT SELECT ON
    v_review_queue, v_high_risk_aged_queue, v_claim_status_summary, v_risk_distribution_over_time,
    v_reference_match_frequency, v_adjuster_workload, v_stale_pending_screening, v_active_session
TO claimguard_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO claimguard_app;
GRANT EXECUTE ON PROCEDURE
    sp_screen_claim(uuid, integer, vector, integer, text, uuid, varchar, varchar),
    sp_decide_claim(uuid, uuid, varchar, text, uuid, uuid, uuid),
    sp_revise_reference_case(uuid, uuid, varchar, text, integer, vector, uuid)
TO claimguard_app;

-- ---------------------------------------------------------------------------
-- claimguard_readonly: the reporting views only (views run with their owner's rights,
-- so no access to the underlying tables is needed or given).
-- ---------------------------------------------------------------------------
GRANT SELECT ON
    v_claim_status_summary, v_review_queue, v_risk_distribution_over_time,
    v_reference_match_frequency, v_adjuster_workload, v_high_risk_aged_queue,
    v_stale_pending_screening
TO claimguard_readonly;

COMMIT;

-- Inspect the result:
--   SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--   WHERE grantee IN ('claimguard_app', 'claimguard_readonly')
--   GROUP BY grantee, table_name ORDER BY grantee, table_name;
