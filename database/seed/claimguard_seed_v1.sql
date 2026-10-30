-- =============================================================================
-- ClaimGuard Seed Data v1 — Realistic dummy records for all 14 tables
-- Compatible with: claimguard_schema_v4.sql (PostgreSQL 16 + pgvector 0.6+)
--
-- Insertion order respects FK dependencies:
--   app_role (pre-seeded by schema) → app_user → embedding_model
--   → policy → risk_rule → reference_fraud_case
--   → claim → screening_assessment → screening_match
--   → review → claim_decision → information_response
--   → notification → audit_log (written automatically by triggers)
--
-- NOTES
--   • Embeddings are 384-dimensional unit vectors produced by a deterministic
--     formula: sin(i/6)/norm, cos(i/6)/norm for dimension i.  They are *not*
--     real model outputs; they satisfy all CHECK constraints and the HNSW
--     non-zero requirement.
--   • Transactions are kept small so a single failure is easy to isolate.
--   • All UUIDs are fixed so the file is idempotent (re-runnable on a fresh DB).
--   • claimguard.actor_id is set per-session so audit triggers record the actor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper: build a deterministic 384-dim unit vector from a seed integer.
--    Used to avoid repeating 384-element literals everywhere.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _seed_vec(p_seed integer) RETURNS vector(384)
LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    SELECT array_agg(
             CASE WHEN (i % 2 = 0)
                  THEN sin(p_seed * 0.1 + i / 6.0)
                  ELSE cos(p_seed * 0.1 + i / 6.0)
             END
           )::vector(384)
    FROM generate_series(1, 384) AS s(i)
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Users  (password_hash is bcrypt of the role + '!Test2026')
--    3 ADMIN · 4 CLAIMS_ADJUSTER · 5 POLICYHOLDER
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;

INSERT INTO app_user (user_id, role_id, email, password_hash, full_name, is_active, created_at)
VALUES
  -- ADMIN users  (role_id = 3)
  ('a1000000-0000-0000-0000-000000000001', 3,
   'admin.priya@claimguard.internal',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Priya Nair', true, '2026-01-10 08:00:00+05:30'),

  ('a1000000-0000-0000-0000-000000000002', 3,
   'admin.rajan@claimguard.internal',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Rajan Menon', true, '2026-01-10 08:15:00+05:30'),

  ('a1000000-0000-0000-0000-000000000003', 3,
   'admin.deepa@claimguard.internal',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Deepa Krishnamurthy', false, '2026-01-11 09:00:00+05:30'),  -- inactive admin

  -- CLAIMS_ADJUSTER users  (role_id = 2)
  ('a2000000-0000-0000-0000-000000000001', 2,
   'adjuster.arjun@claimguard.internal',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Arjun Sharma', true, '2026-01-12 10:00:00+05:30'),

  ('a2000000-0000-0000-0000-000000000002', 2,
   'adjuster.meera@claimguard.internal',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Meera Pillai', true, '2026-01-12 10:30:00+05:30'),

  ('a2000000-0000-0000-0000-000000000003', 2,
   'adjuster.vikram@claimguard.internal',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Vikram Iyer', true, '2026-01-13 09:00:00+05:30'),

  ('a2000000-0000-0000-0000-000000000004', 2,
   'adjuster.sneha@claimguard.internal',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Sneha Kulkarni', true, '2026-01-14 11:00:00+05:30'),

  -- POLICYHOLDER users  (role_id = 1)
  ('a3000000-0000-0000-0000-000000000001', 1,
   'holder.ananya@example.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Ananya Rao', true, '2026-02-01 09:00:00+05:30'),

  ('a3000000-0000-0000-0000-000000000002', 1,
   'holder.suresh@example.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Suresh Babu', true, '2026-02-03 10:00:00+05:30'),

  ('a3000000-0000-0000-0000-000000000003', 1,
   'holder.kavitha@example.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Kavitha Reddy', true, '2026-02-05 11:00:00+05:30'),

  ('a3000000-0000-0000-0000-000000000004', 1,
   'holder.mohan@example.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Mohan Das', true, '2026-02-07 08:30:00+05:30'),

  ('a3000000-0000-0000-0000-000000000005', 1,
   'holder.lakshmi@example.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJmHJfG7DaxNvvb0lGHcQD6.',
   'Lakshmi Nambiar', true, '2026-02-10 14:00:00+05:30');

-- ---------------------------------------------------------------------------
-- 2. Embedding model
-- ---------------------------------------------------------------------------
INSERT INTO embedding_model (model_id, model_name, model_version, dimension, created_at)
OVERRIDING SYSTEM VALUE
VALUES (1, 'all-MiniLM-L6-v2', 'v1.0', 384, '2026-01-05 07:00:00+05:30');

-- ---------------------------------------------------------------------------
-- 3. Policies  (audit trigger fires here; actor_id blank → SYSTEM actor)
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a1000000-0000-0000-0000-000000000001', false); END $$;

INSERT INTO policy (policy_id, policy_number, holder_id, effective_date, expiry_date, is_active, created_at)
VALUES
  ('b1000000-0000-0000-0000-000000000001', 'POL-2026-0001',
   'a3000000-0000-0000-0000-000000000001', '2026-01-01', '2027-01-01', true,
   '2026-01-15 10:00:00+05:30'),

  ('b1000000-0000-0000-0000-000000000002', 'POL-2026-0002',
   'a3000000-0000-0000-0000-000000000002', '2026-02-01', '2027-02-01', true,
   '2026-02-01 11:00:00+05:30'),

  ('b1000000-0000-0000-0000-000000000003', 'POL-2026-0003',
   'a3000000-0000-0000-0000-000000000003', '2025-06-01', '2026-06-01', true,
   '2025-06-01 09:00:00+05:30'),

  ('b1000000-0000-0000-0000-000000000004', 'POL-2026-0004',
   'a3000000-0000-0000-0000-000000000004', '2026-03-01', '2027-03-01', true,
   '2026-03-01 08:00:00+05:30'),

  ('b1000000-0000-0000-0000-000000000005', 'POL-2026-0005',
   'a3000000-0000-0000-0000-000000000005', '2026-04-01', '2027-04-01', true,
   '2026-04-01 09:00:00+05:30'),

  -- expired policy (no new claims can be filed; used for edge-case testing)
  ('b1000000-0000-0000-0000-000000000006', 'POL-2025-0099',
   'a3000000-0000-0000-0000-000000000001', '2024-01-01', '2025-01-01', false,
   '2024-01-01 10:00:00+05:30');

-- ---------------------------------------------------------------------------
-- 4. Risk rules  (only one may be active at a time — enforced by partial UX)
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a1000000-0000-0000-0000-000000000001', false); END $$;

INSERT INTO risk_rule (risk_rule_id, rule_version, definition, is_active, created_by, created_at)
OVERRIDING SYSTEM VALUE
VALUES
  (1, 'v1.0',
   '{"high_similarity_threshold": 0.85, "medium_similarity_threshold": 0.65, "description": "Initial conservative thresholds"}'::jsonb,
   false,
   'a1000000-0000-0000-0000-000000000001',
   '2026-01-20 10:00:00+05:30'),

  (2, 'v1.1',
   '{"high_similarity_threshold": 0.80, "medium_similarity_threshold": 0.60, "description": "Slightly relaxed after review — more patterns surfaced"}'::jsonb,
   true,
   'a1000000-0000-0000-0000-000000000001',
   '2026-03-01 12:00:00+05:30');

-- ---------------------------------------------------------------------------
-- 5. Reference fraud cases  (admin creates; embedding model must be ID=1)
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a1000000-0000-0000-0000-000000000001', false); END $$;

INSERT INTO reference_fraud_case
  (case_id, title, description, is_confirmed, is_active,
   embedding_model_id, embedding, created_by, created_at,
   deactivated_by, deactivated_at)
VALUES
  ('c1000000-0000-0000-0000-000000000001',
   'Staged Vehicle Collision — Highway NH-44',
   'Claimant reported a head-on collision on highway NH-44 during late-night hours. '
   'Independent witnesses contradicted the stated location. Repair estimate was inflated '
   'by collusion with workshop. Pattern: late-night incident, single claimant, inflated repair.',
   true, true, 1, _seed_vec(101),
   'a1000000-0000-0000-0000-000000000001', '2026-02-01 09:00:00+05:30',
   NULL, NULL),

  ('c1000000-0000-0000-0000-000000000002',
   'Water Damage — Repeated Claims Same Address',
   'Multiple water-damage claims filed within 12 months for the same residential address '
   'under different policy holders. Third-party assessment found no structural cause for '
   'repeated flooding. Pattern: same location, multiple claimants, no underlying cause.',
   true, true, 1, _seed_vec(102),
   'a1000000-0000-0000-0000-000000000001', '2026-02-03 10:00:00+05:30',
   NULL, NULL),

  ('c1000000-0000-0000-0000-000000000003',
   'Medical Procedure Not Performed — Phantom Treatment',
   'Claim submitted for surgical procedure. Hospital records did not confirm the procedure. '
   'Provider and claimant were linked by prior business relationship. '
   'Pattern: non-existent treatment, provider-claimant relationship.',
   true, true, 1, _seed_vec(103),
   'a1000000-0000-0000-0000-000000000002', '2026-02-05 11:00:00+05:30',
   NULL, NULL),

  ('c1000000-0000-0000-0000-000000000004',
   'Fire Damage — Arson Investigation Confirmed',
   'Property fire reported as accidental. Fire investigation report confirmed accelerant '
   'use. Claimant had financial distress and had recently increased coverage. '
   'Pattern: recent coverage increase, financial distress, arson confirmed.',
   true, true, 1, _seed_vec(104),
   'a1000000-0000-0000-0000-000000000002', '2026-02-08 14:00:00+05:30',
   NULL, NULL),

  ('c1000000-0000-0000-0000-000000000005',
   'Theft Claim — Item Never Owned',
   'High-value electronics theft claimed. Purchase receipts provided were forged. '
   'Forensic analysis confirmed receipts were digitally altered. '
   'Pattern: forged receipts, high-value single item, no prior evidence of ownership.',
   true, true, 1, _seed_vec(105),
   'a1000000-0000-0000-0000-000000000001', '2026-02-10 09:00:00+05:30',
   NULL, NULL),

  ('c1000000-0000-0000-0000-000000000006',
   'Slip and Fall — Coordinated Claimant Network',
   'Multiple unrelated claimants submitted slip-and-fall claims against the same commercial '
   'property within one week. Investigation revealed a coordinated scheme between claimants '
   'and a lawyer referral network. Pattern: clustered timing, shared legal representation.',
   true, true, 1, _seed_vec(106),
   'a1000000-0000-0000-0000-000000000001', '2026-02-12 10:30:00+05:30',
   NULL, NULL),

  -- Deactivated reference case (for testing deactivation path)
  ('c1000000-0000-0000-0000-000000000007',
   'Duplicate Claim — Same Incident Different Policies',
   'Identical incident reported under two separate policies held by related parties. '
   'Payout was claimed twice for the same loss event. Pattern: duplicate incident description, '
   'linked policyholders.',
   true, false, 1, _seed_vec(107),
   'a1000000-0000-0000-0000-000000000002', '2026-02-15 11:00:00+05:30',
   'a1000000-0000-0000-0000-000000000001', '2026-04-01 09:00:00+05:30');

-- ---------------------------------------------------------------------------
-- 6. Claims  (claimant_id must equal holder_id of the referenced policy)
--    Ordered so later claims can reference earlier screenings
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a3000000-0000-0000-0000-000000000001', false); END $$;

-- Claim 1: Ananya Rao — vehicle collision — will be screened HIGH-risk → reviewed → APPROVED
INSERT INTO claim (claim_id, policy_id, claimant_id, incident_date, claimed_amount,
                   description, claim_status, screening_status, review_required, submitted_at, updated_at)
VALUES (
  'd1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  '2026-05-14',
  87500.00,
  'My vehicle was involved in a collision on the highway during late evening. '
  'The other vehicle did not stop. Repair estimate obtained from an authorized workshop. '
  'Police FIR lodged the same night.',
  'SUBMITTED', 'PENDING', false,
  '2026-05-15 09:30:00+05:30', '2026-05-15 09:30:00+05:30'
);

DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a3000000-0000-0000-0000-000000000002', false); END $$;

-- Claim 2: Suresh Babu — water damage — will be screened MEDIUM-risk → reviewed → INFO_REQUESTED → response → REJECTED
INSERT INTO claim (claim_id, policy_id, claimant_id, incident_date, claimed_amount,
                   description, claim_status, screening_status, review_required, submitted_at, updated_at)
VALUES (
  'd1000000-0000-0000-0000-000000000002',
  'b1000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000002',
  '2026-06-02',
  45000.00,
  'Water leakage from the roof caused extensive damage to furniture and flooring on the '
  'second floor. Third-party plumber confirmed the source was a cracked overhead pipe. '
  'This is the second such incident in 12 months at this address.',
  'SUBMITTED', 'PENDING', false,
  '2026-06-03 11:00:00+05:30', '2026-06-03 11:00:00+05:30'
);

DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a3000000-0000-0000-0000-000000000003', false); END $$;

-- Claim 3: Kavitha Reddy — medical claim — will be screened HIGH-risk → pending review (open)
INSERT INTO claim (claim_id, policy_id, claimant_id, incident_date, claimed_amount,
                   description, claim_status, screening_status, review_required, submitted_at, updated_at)
VALUES (
  'd1000000-0000-0000-0000-000000000003',
  'b1000000-0000-0000-0000-000000000003',
  'a3000000-0000-0000-0000-000000000003',
  '2026-05-20',
  125000.00,
  'Hospitalization and surgical procedure at a private hospital. '
  'The attending surgeon recommended the operation after diagnosis. '
  'All medical certificates and discharge summary attached.',
  'SUBMITTED', 'PENDING', false,
  '2026-05-22 10:00:00+05:30', '2026-05-22 10:00:00+05:30'
);

DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a3000000-0000-0000-0000-000000000004', false); END $$;

-- Claim 4: Mohan Das — fire/property — will fail screening (simulate embedding service outage)
INSERT INTO claim (claim_id, policy_id, claimant_id, incident_date, claimed_amount,
                   description, claim_status, screening_status, review_required, submitted_at, updated_at)
VALUES (
  'd1000000-0000-0000-0000-000000000004',
  'b1000000-0000-0000-0000-000000000004',
  'a3000000-0000-0000-0000-000000000004',
  '2026-07-01',
  215000.00,
  'Fire broke out in the kitchen due to an electrical fault. The fire spread to '
  'adjacent rooms before being controlled. Fire department report confirms electrical '
  'cause. Property coverage claim for rebuilding costs.',
  'SUBMITTED', 'PENDING', false,
  '2026-07-02 08:00:00+05:30', '2026-07-02 08:00:00+05:30'
);

DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a3000000-0000-0000-0000-000000000005', false); END $$;

-- Claim 5: Lakshmi Nambiar — theft — screening LOW-risk, APPROVED without review
INSERT INTO claim (claim_id, policy_id, claimant_id, incident_date, claimed_amount,
                   description, claim_status, screening_status, review_required, submitted_at, updated_at)
VALUES (
  'd1000000-0000-0000-0000-000000000005',
  'b1000000-0000-0000-0000-000000000005',
  'a3000000-0000-0000-0000-000000000005',
  '2026-07-10',
  12000.00,
  'Bicycle stolen from outside residence while secured to a post. '
  'FIR lodged with local police station. Purchase receipt and photos available.',
  'SUBMITTED', 'PENDING', false,
  '2026-07-11 14:00:00+05:30', '2026-07-11 14:00:00+05:30'
);

-- Claim 6: Ananya Rao — second claim on same policy — remains PENDING (no screening yet)
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a3000000-0000-0000-0000-000000000001', false); END $$;
INSERT INTO claim (claim_id, policy_id, claimant_id, incident_date, claimed_amount,
                   description, claim_status, screening_status, review_required, submitted_at, updated_at)
VALUES (
  'd1000000-0000-0000-0000-000000000006',
  'b1000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  '2026-08-01',
  5500.00,
  'Windshield crack reported during regular vehicle inspection. '
  'Glass replacement recommended by authorized service centre.',
  'SUBMITTED', 'PENDING', false,
  '2026-08-02 10:00:00+05:30', '2026-08-02 10:00:00+05:30'
);

-- ---------------------------------------------------------------------------
-- 7. Screening assessments + matches (in single transactions per claim)
--    Assessment triggers update claim.screening_status automatically.
-- ---------------------------------------------------------------------------

-- ── Assessment for Claim 1 (HIGH-risk, MATCHES_FOUND) ────────────────────
BEGIN;
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;
INSERT INTO screening_assessment
  (assessment_id, claim_id, attempt_no, status, outcome,
   risk_indicator, risk_rule_version,
   embedding_model_id, description_embedding,
   top_k, similarity_metric, failure_reason)
VALUES (
  'e1000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000001',
  1, 'COMPLETED', 'MATCHES_FOUND', 'HIGH', 'v1.1',
  1, _seed_vec(201),
  3, 'cosine_similarity', NULL
);

INSERT INTO screening_match (assessment_id, reference_case_id, embedding_model_id, match_rank, similarity_score)
VALUES
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1, 1, 0.9121),
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 1, 2, 0.7834),
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 1, 3, 0.6215);
COMMIT;

-- ── Assessment for Claim 2 (MEDIUM-risk, MATCHES_FOUND) ──────────────────
BEGIN;
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;
INSERT INTO screening_assessment
  (assessment_id, claim_id, attempt_no, status, outcome,
   risk_indicator, risk_rule_version,
   embedding_model_id, description_embedding,
   top_k, similarity_metric, failure_reason)
VALUES (
  'e1000000-0000-0000-0000-000000000002',
  'd1000000-0000-0000-0000-000000000002',
  1, 'COMPLETED', 'MATCHES_FOUND', 'MEDIUM', 'v1.1',
  1, _seed_vec(202),
  3, 'cosine_similarity', NULL
);

INSERT INTO screening_match (assessment_id, reference_case_id, embedding_model_id, match_rank, similarity_score)
VALUES
  ('e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 1, 1, 0.7456),
  ('e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 1, 2, 0.6102),
  ('e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003', 1, 3, 0.5301);
COMMIT;

-- ── Assessment for Claim 3 (HIGH-risk, MATCHES_FOUND) ────────────────────
BEGIN;
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;
INSERT INTO screening_assessment
  (assessment_id, claim_id, attempt_no, status, outcome,
   risk_indicator, risk_rule_version,
   embedding_model_id, description_embedding,
   top_k, similarity_metric, failure_reason)
VALUES (
  'e1000000-0000-0000-0000-000000000003',
  'd1000000-0000-0000-0000-000000000003',
  1, 'COMPLETED', 'MATCHES_FOUND', 'HIGH', 'v1.1',
  1, _seed_vec(203),
  3, 'cosine_similarity', NULL
);

INSERT INTO screening_match (assessment_id, reference_case_id, embedding_model_id, match_rank, similarity_score)
VALUES
  ('e1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 1, 1, 0.8822),
  ('e1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000005', 1, 2, 0.7490),
  ('e1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 1, 3, 0.6033);
COMMIT;

-- ── Assessment for Claim 4 (FAILED — embedding service outage) ────────────
BEGIN;
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;
INSERT INTO screening_assessment
  (assessment_id, claim_id, attempt_no, status, outcome,
   risk_indicator, risk_rule_version,
   embedding_model_id, description_embedding,
   top_k, similarity_metric, failure_reason)
VALUES (
  'e1000000-0000-0000-0000-000000000004',
  'd1000000-0000-0000-0000-000000000004',
  1, 'FAILED', NULL, NULL, NULL,
  NULL, NULL,
  NULL, NULL,
  'Embedding service unavailable: connection timeout after 30 s (attempt 1)'
);
COMMIT;

-- ── Assessment for Claim 5 (LOW-risk, NO_MATCH) ───────────────────────────
BEGIN;
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;
INSERT INTO screening_assessment
  (assessment_id, claim_id, attempt_no, status, outcome,
   risk_indicator, risk_rule_version,
   embedding_model_id, description_embedding,
   top_k, similarity_metric, failure_reason)
VALUES (
  'e1000000-0000-0000-0000-000000000005',
  'd1000000-0000-0000-0000-000000000005',
  1, 'COMPLETED', 'NO_MATCH', 'LOW', 'v1.1',
  1, _seed_vec(205),
  3, 'cosine_similarity', NULL
);
-- NO matches inserted (outcome = NO_MATCH, so none expected)
COMMIT;

-- ---------------------------------------------------------------------------
-- 8. Reviews and decisions
--    Claim 1: UNDER_REVIEW → APPROVED decision
--    Claim 2: UNDER_REVIEW → INFO_REQUESTED → (response) → UNDER_REVIEW → REJECTED
--    Claim 3: UNDER_REVIEW (open — no decision yet)
--    Claim 5: APPROVED directly (LOW-risk, no adjuster flag needed, but adjuster does review)
-- ---------------------------------------------------------------------------

-- Transition claim statuses before inserting reviews
-- (Direct status update from SUBMITTED → UNDER_REVIEW is allowed for application)
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a2000000-0000-0000-0000-000000000001', false); END $$;
UPDATE claim SET claim_status = 'UNDER_REVIEW' WHERE claim_id = 'd1000000-0000-0000-0000-000000000001';
UPDATE claim SET claim_status = 'UNDER_REVIEW' WHERE claim_id = 'd1000000-0000-0000-0000-000000000002';
UPDATE claim SET claim_status = 'UNDER_REVIEW' WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
UPDATE claim SET claim_status = 'UNDER_REVIEW' WHERE claim_id = 'd1000000-0000-0000-0000-000000000005';

-- Review for Claim 1: APPROVED
INSERT INTO review (review_id, claim_id, assessment_id, reviewer_id, review_action, notes, reviewed_at)
VALUES (
  'f1000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'APPROVED',
  'Evidence reviewed. Similarity matches flagged concern but FIR, repair records and '
  'independent assessment confirm legitimate collision. Approved at adjuster discretion.',
  '2026-06-01 15:00:00+05:30'
);

-- Decision for Claim 1: APPROVED
INSERT INTO claim_decision (decision_id, claim_id, review_id, decision_status, decided_at)
VALUES (
  '71000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001',
  'APPROVED',
  '2026-06-01 15:30:00+05:30'
);

-- Review for Claim 2: INFO_REQUESTED first
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a2000000-0000-0000-0000-000000000002', false); END $$;
UPDATE claim SET claim_status = 'AWAITING_INFO' WHERE claim_id = 'd1000000-0000-0000-0000-000000000002';

INSERT INTO review (review_id, claim_id, assessment_id, reviewer_id, review_action, notes, reviewed_at)
VALUES (
  'f1000000-0000-0000-0000-000000000002',
  'd1000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000002',
  'INFO_REQUESTED',
  'Pattern matches two water-damage cases at same address. Require proof of plumber visit, '
  'independent structural survey, and previous claim history.',
  '2026-06-10 14:00:00+05:30'
);

-- Policyholder responds to information request
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a3000000-0000-0000-0000-000000000002', false); END $$;
INSERT INTO information_response (response_id, review_id, claim_id, responder_id, body, responded_at)
VALUES (
  '81000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'd1000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000002',
  'Attached: (1) Plumber visit receipt dated 3-Jun-2026, (2) Building society structural '
  'survey report confirming overhead pipe failure, (3) Previous claim was for a different '
  'cause (blocked drain) repaired in full at that time.',
  '2026-06-13 10:00:00+05:30'
);

-- Adjuster resumes review → REJECTED
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a2000000-0000-0000-0000-000000000002', false); END $$;
UPDATE claim SET claim_status = 'UNDER_REVIEW' WHERE claim_id = 'd1000000-0000-0000-0000-000000000002';

INSERT INTO review (review_id, claim_id, assessment_id, reviewer_id, review_action, notes, reviewed_at)
VALUES (
  'f1000000-0000-0000-0000-000000000003',
  'd1000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000002',
  'REJECTED',
  'Survey confirms structural pipe failure but repeated claims at same address within '
  '12 months exceeds acceptable risk threshold under policy terms. Claim rejected.',
  '2026-06-20 16:00:00+05:30'
);

-- Decision for Claim 2: REJECTED
INSERT INTO claim_decision (decision_id, claim_id, review_id, decision_status, decided_at)
VALUES (
  '71000000-0000-0000-0000-000000000002',
  'd1000000-0000-0000-0000-000000000002',
  'f1000000-0000-0000-0000-000000000003',
  'REJECTED',
  '2026-06-20 16:30:00+05:30'
);

-- Review for Claim 3: still open (adjuster reviewing HIGH-risk medical claim)
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a2000000-0000-0000-0000-000000000003', false); END $$;
INSERT INTO review (review_id, claim_id, assessment_id, reviewer_id, review_action, notes, reviewed_at)
VALUES (
  'f1000000-0000-0000-0000-000000000004',
  'd1000000-0000-0000-0000-000000000003',
  'e1000000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000003',
  'INFO_REQUESTED',
  'High similarity to phantom treatment case. Requesting original hospital records, '
  'surgeon licence number, and operative notes directly from hospital.',
  '2026-06-25 11:00:00+05:30'
);

UPDATE claim SET claim_status = 'AWAITING_INFO' WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';

-- Review for Claim 5: APPROVED (LOW-risk bicycle theft)
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', 'a2000000-0000-0000-0000-000000000004', false); END $$;
INSERT INTO review (review_id, claim_id, assessment_id, reviewer_id, review_action, notes, reviewed_at)
VALUES (
  'f1000000-0000-0000-0000-000000000005',
  'd1000000-0000-0000-0000-000000000005',
  'e1000000-0000-0000-0000-000000000005',
  'a2000000-0000-0000-0000-000000000004',
  'APPROVED',
  'FIR verified. No pattern match. Claimed amount within policy limit. Approved.',
  '2026-07-15 10:00:00+05:30'
);

-- Decision for Claim 5: APPROVED
INSERT INTO claim_decision (decision_id, claim_id, review_id, decision_status, decided_at)
VALUES (
  '71000000-0000-0000-0000-000000000003',
  'd1000000-0000-0000-0000-000000000005',
  'f1000000-0000-0000-0000-000000000005',
  'APPROVED',
  '2026-07-15 10:30:00+05:30'
);

-- ---------------------------------------------------------------------------
-- 9. Notifications
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;

INSERT INTO notification (notification_id, user_id, claim_id, notification_type, message, created_at, read_at, dismissed_at)
VALUES
  -- Policyholder notified: claim approved
  ('91000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001',
   'CLAIM_APPROVED',
   'Your claim POL-2026-0001 / Claim 1 has been approved. Settlement processing will begin shortly.',
   '2026-06-01 15:30:00+05:30',
   '2026-06-02 09:00:00+05:30', NULL),

  -- Policyholder notified: claim rejected
  ('91000000-0000-0000-0000-000000000002',
   'a3000000-0000-0000-0000-000000000002',
   'd1000000-0000-0000-0000-000000000002',
   'CLAIM_REJECTED',
   'Your claim under POL-2026-0002 has been rejected. Please contact support for more details.',
   '2026-06-20 16:30:00+05:30',
   '2026-06-21 08:00:00+05:30', '2026-06-21 08:05:00+05:30'),

  -- Information request notification
  ('91000000-0000-0000-0000-000000000003',
   'a3000000-0000-0000-0000-000000000003',
   'd1000000-0000-0000-0000-000000000003',
   'INFO_REQUESTED',
   'Additional information has been requested for your medical claim. Please respond within 14 days.',
   '2026-06-25 11:00:00+05:30',
   NULL, NULL),

  -- Screening failure notification (to adjuster)
  ('91000000-0000-0000-0000-000000000004',
   'a2000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000004',
   'SCREENING_FAILED',
   'Screening failed for claim d1000000-0000-0000-0000-000000000004 (attempt 1). Manual review may be required.',
   '2026-07-02 08:05:00+05:30',
   '2026-07-02 09:00:00+05:30', NULL),

  -- Bicycle claim approved
  ('91000000-0000-0000-0000-000000000005',
   'a3000000-0000-0000-0000-000000000005',
   'd1000000-0000-0000-0000-000000000005',
   'CLAIM_APPROVED',
   'Your bicycle theft claim has been approved. Payout will be processed in 3-5 business days.',
   '2026-07-15 10:30:00+05:30',
   NULL, NULL);

-- ---------------------------------------------------------------------------
-- 10. Cleanup helper function (not part of production schema)
-- ---------------------------------------------------------------------------
DROP FUNCTION _seed_vec(integer);

-- Reset actor context
DO $$ BEGIN PERFORM set_config('claimguard.actor_id', '', false); END $$;

