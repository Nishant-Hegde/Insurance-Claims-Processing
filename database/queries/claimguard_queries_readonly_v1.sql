-- =============================================================================
-- ClaimGuard SQL Query Collection v1 — READ-ONLY subset
-- Compatible with: claimguard_schema_v4.sql + claimguard_seed_v1.sql
--   + migrations 001 and 002 (section H calls the migration 002 procedures)
--
-- SECTIONS
--   A.  Basic SELECT — single-table queries
--   B.  Joins — multi-table queries
--   C.  Aggregation — GROUP BY / HAVING / FILTER
--   D.  Subqueries — correlated and uncorrelated
--   E.  CTEs (WITH clauses)
--   F.  Window functions
--   G.  Project-specific queries — fraud detection, workflow, analytics
--   H.  Transactions and stored procedures (migration 002) — rollback-only demos
--
-- Excludes the mutation sections G9–G14 and H4–H7 of claimguard_queries_v1.sql.
-- Section H here only runs demos that are rolled back, so the database is left unchanged.
-- =============================================================================

-- =============================================================================
-- SECTION A — Basic SELECT queries
-- =============================================================================

-- A1. List all active users with their role names
SELECT u.user_id,
       u.full_name,
       u.email,
       r.role_name,
       u.created_at::date AS joined_date
FROM   app_user u
JOIN   app_role r ON r.role_id = u.role_id
WHERE  u.is_active
ORDER  BY r.role_name, u.full_name;

-- A2. Show all active policies with holder name and coverage period
SELECT p.policy_number,
       u.full_name           AS holder_name,
       p.effective_date,
       p.expiry_date,
       (p.expiry_date - p.effective_date) AS coverage_days
FROM   policy p
JOIN   app_user u ON u.user_id = p.holder_id
WHERE  p.is_active
ORDER  BY p.effective_date DESC;

-- A3. Fetch all claims with their current status and amounts
SELECT c.claim_id,
       p.policy_number,
       u.full_name          AS claimant,
       c.incident_date,
       c.claimed_amount,
       c.claim_status,
       c.screening_status,
       c.review_required
FROM   claim c
JOIN   policy p   ON p.policy_id  = c.policy_id
JOIN   app_user u ON u.user_id    = c.claimant_id
ORDER  BY c.submitted_at DESC;

-- A4. List all active reference fraud cases with description excerpt
SELECT case_id,
       title,
       left(description, 100) || '...' AS description_excerpt,
       is_confirmed,
       created_at::date
FROM   reference_fraud_case
WHERE  is_active
ORDER  BY created_at DESC;

-- A5. Show versioned risk rules and their threshold configuration
SELECT risk_rule_id,
       rule_version,
       (definition->>'high_similarity_threshold')::numeric   AS high_threshold,
       (definition->>'medium_similarity_threshold')::numeric AS medium_threshold,
       is_active,
       created_at::date
FROM   risk_rule
ORDER  BY risk_rule_id;

-- A6. All notifications for a specific user — unread first
SELECT notification_id,
       notification_type,
       message,
       created_at,
       read_at,
       dismissed_at
FROM   notification
WHERE  user_id = 'a3000000-0000-0000-0000-000000000001'
ORDER  BY read_at NULLS FIRST, created_at DESC;

-- A7. Full-text search on claim descriptions (FR-20)
SELECT claim_id,
       claimed_amount,
       ts_headline('english', description,
                   plainto_tsquery('english', 'collision highway'),
                   'MaxWords=15, MinWords=5') AS matched_excerpt,
       ts_rank(to_tsvector('english', description),
               plainto_tsquery('english', 'collision highway')) AS rank
FROM   claim
WHERE  to_tsvector('english', description)
       @@ plainto_tsquery('english', 'collision highway')
ORDER  BY rank DESC;

-- =============================================================================
-- SECTION B — Join queries
-- =============================================================================

-- B1. Claims with their latest screening assessment outcome
SELECT c.claim_id,
       u.full_name           AS claimant,
       c.claimed_amount,
       c.claim_status,
       a.attempt_no          AS last_attempt,
       a.status              AS screening_status,
       a.outcome,
       a.risk_indicator,
       a.risk_rule_version
FROM   claim c
JOIN   app_user u ON u.user_id = c.claimant_id
LEFT JOIN LATERAL (
    SELECT attempt_no, status, outcome, risk_indicator, risk_rule_version
    FROM   screening_assessment
    WHERE  claim_id = c.claim_id
    ORDER  BY attempt_no DESC
    LIMIT  1
) a ON true
ORDER  BY c.submitted_at DESC;

-- B2. Screening matches with reference case details (similarity evidence table)
SELECT m.assessment_id,
       m.match_rank,
       round(m.similarity_score::numeric, 4) AS similarity,
       r.title                               AS matched_case_title,
       left(r.description, 80) || '...'     AS case_description_excerpt,
       c.claim_id,
       claimant.full_name                   AS claimant
FROM   screening_match m
JOIN   reference_fraud_case r ON r.case_id    = m.reference_case_id
JOIN   screening_assessment a ON a.assessment_id = m.assessment_id
JOIN   claim c                ON c.claim_id   = a.claim_id
JOIN   app_user claimant      ON claimant.user_id = c.claimant_id
ORDER  BY m.assessment_id, m.match_rank;

-- B3. Review history per claim with reviewer name and action
SELECT c.claim_id,
       p.policy_number,
       adj.full_name    AS adjuster,
       rv.review_action,
       rv.notes,
       rv.reviewed_at
FROM   review rv
JOIN   claim c     ON c.claim_id    = rv.claim_id
JOIN   policy p    ON p.policy_id   = c.policy_id
JOIN   app_user adj ON adj.user_id  = rv.reviewer_id
ORDER  BY c.claim_id, rv.reviewed_at;

-- B4. Decisions with their supporting review and claim context
SELECT cd.decision_id,
       cd.decision_status,
       cd.decided_at::date,
       c.claim_id,
       p.policy_number,
       holder.full_name   AS policyholder,
       c.claimed_amount,
       adj.full_name      AS deciding_adjuster
FROM   claim_decision cd
JOIN   review rv       ON rv.review_id  = cd.review_id
JOIN   claim c         ON c.claim_id    = cd.claim_id
JOIN   policy p        ON p.policy_id   = c.policy_id
JOIN   app_user holder ON holder.user_id = c.claimant_id
JOIN   app_user adj    ON adj.user_id    = rv.reviewer_id
ORDER  BY cd.decided_at DESC;

-- B5. Information responses with their triggering review context
SELECT ir.response_id,
       p.policy_number,
       holder.full_name   AS responder,
       adj.full_name      AS requesting_adjuster,
       rv.review_action,
       left(rv.notes, 60) || '...'  AS request_summary,
       left(ir.body, 80) || '...'   AS response_excerpt,
       ir.responded_at
FROM   information_response ir
JOIN   review rv        ON rv.review_id   = ir.review_id
JOIN   claim c          ON c.claim_id     = ir.claim_id
JOIN   policy p         ON p.policy_id    = c.policy_id
JOIN   app_user holder  ON holder.user_id = ir.responder_id
JOIN   app_user adj     ON adj.user_id    = rv.reviewer_id;

-- B6. Audit log with actor and target resolved to human-readable names
SELECT al.audit_id,
       al.occurred_at,
       al.actor_type,
       COALESCE(actor.full_name, 'SYSTEM') AS actor,
       al.action,
       c.claim_id                          AS target_claim,
       COALESCE(target_user.full_name, '') AS target_user
FROM   audit_log al
LEFT JOIN app_user actor       ON actor.user_id       = al.actor_id
LEFT JOIN claim c              ON c.claim_id          = al.claim_id
LEFT JOIN app_user target_user ON target_user.user_id = al.target_user_id
ORDER  BY al.occurred_at DESC
LIMIT  30;

-- =============================================================================
-- SECTION C — Aggregation queries
-- =============================================================================

-- C1. Claims summary: count by status and screening status
SELECT claim_status,
       screening_status,
       count(*)              AS claim_count,
       sum(claimed_amount)   AS total_claimed,
       avg(claimed_amount)   AS avg_claimed
FROM   claim
GROUP  BY claim_status, screening_status
ORDER  BY claim_count DESC;

-- C2. Adjuster workload — reviews, approvals, rejections, info requests
SELECT adj.full_name                AS adjuster,
       count(*)                     AS total_reviews,
       count(*) FILTER (WHERE rv.review_action = 'APPROVED')       AS approvals,
       count(*) FILTER (WHERE rv.review_action = 'REJECTED')       AS rejections,
       count(*) FILTER (WHERE rv.review_action = 'INFO_REQUESTED') AS info_requests
FROM   review rv
JOIN   app_user adj ON adj.user_id = rv.reviewer_id
GROUP  BY adj.full_name
ORDER  BY total_reviews DESC;

-- C3. Reference case match frequency — most implicated cases
SELECT r.title,
       count(m.match_id)                        AS times_matched,
       round(avg(m.similarity_score)::numeric, 4) AS avg_similarity,
       round(max(m.similarity_score)::numeric, 4) AS max_similarity
FROM   reference_fraud_case r
JOIN   screening_match m ON m.reference_case_id = r.case_id
GROUP  BY r.case_id, r.title
ORDER  BY times_matched DESC, avg_similarity DESC;

-- C4. Risk distribution: count of completed assessments per risk level
SELECT risk_indicator,
       count(*)                AS assessment_count,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM   screening_assessment
WHERE  status = 'COMPLETED'
GROUP  BY risk_indicator
ORDER  BY assessment_count DESC;

-- C5. Policyholder claim summary (total claims, total amount, approved vs rejected)
SELECT u.full_name                        AS policyholder,
       count(c.claim_id)                  AS total_claims,
       sum(c.claimed_amount)              AS total_amount_claimed,
       count(cd.decision_id) FILTER (WHERE cd.decision_status = 'APPROVED') AS approved,
       count(cd.decision_id) FILTER (WHERE cd.decision_status = 'REJECTED') AS rejected
FROM   app_user u
JOIN   claim c        ON c.claimant_id = u.user_id
LEFT JOIN claim_decision cd ON cd.claim_id = c.claim_id
GROUP  BY u.user_id, u.full_name
HAVING count(c.claim_id) > 0
ORDER  BY total_claims DESC;

-- C6. Monthly claim submission trend
SELECT date_trunc('month', submitted_at)::date AS month,
       count(*)                                AS claims_submitted,
       sum(claimed_amount)                     AS total_claimed,
       count(*) FILTER (WHERE review_required) AS high_risk_flagged
FROM   claim
GROUP  BY date_trunc('month', submitted_at)
ORDER  BY month;

-- =============================================================================
-- SECTION D — Subqueries
-- =============================================================================

-- D1. Claims that have never been screened (no assessment record at all)
--     (correlated: the NOT EXISTS subquery refers to the outer c.claim_id)
SELECT c.claim_id,
       u.full_name  AS claimant,
       c.submitted_at
FROM   claim c
JOIN   app_user u ON u.user_id = c.claimant_id
WHERE  NOT EXISTS (
    SELECT 1
    FROM   screening_assessment a
    WHERE  a.claim_id = c.claim_id
)
ORDER  BY c.submitted_at;

-- D2. Reference cases not yet matched to any screening result
SELECT case_id,
       title,
       created_at::date
FROM   reference_fraud_case
WHERE  is_active
  AND  case_id NOT IN (
      SELECT DISTINCT reference_case_id FROM screening_match
  )
ORDER  BY created_at;

-- D3. Claims whose latest assessment was a FAILURE (need retry)
SELECT c.claim_id,
       u.full_name  AS claimant,
       c.submitted_at,
       latest.failure_reason
FROM   claim c
JOIN   app_user u ON u.user_id = c.claimant_id
JOIN   (
    SELECT DISTINCT ON (claim_id)
           claim_id, status, failure_reason
    FROM   screening_assessment
    ORDER  BY claim_id, attempt_no DESC
) latest ON latest.claim_id = c.claim_id AND latest.status = 'FAILED'
WHERE  c.screening_status = 'FAILED';

-- D4. Adjusters who have approved more than the average number of claims across all adjusters
SELECT adj.full_name,
       COUNT(*) AS approvals
FROM   review rv
JOIN   app_user adj ON adj.user_id = rv.reviewer_id
WHERE  rv.review_action = 'APPROVED'
GROUP  BY adj.user_id, adj.full_name
HAVING COUNT(*) > (
    SELECT AVG(adj_count)
    FROM (
        SELECT COUNT(*) AS adj_count
        FROM   review
        WHERE  review_action = 'APPROVED'
        GROUP  BY reviewer_id
    ) sub
);

-- D5. Claims under policies that have had at least two distinct claims
SELECT c.claim_id,
       p.policy_number,
       c.claim_status,
       c.claimed_amount
FROM   claim c
JOIN   policy p ON p.policy_id = c.policy_id
WHERE  p.policy_id IN (
    SELECT policy_id
    FROM   claim
    GROUP  BY policy_id
    HAVING count(*) >= 2
)
ORDER  BY p.policy_number, c.submitted_at;

-- D6. Users who have received at least one unread notification (correlated EXISTS + scalar subquery)
SELECT u.full_name,
       u.email,
       (SELECT count(*) FROM notification n
        WHERE  n.user_id = u.user_id AND n.read_at IS NULL) AS unread_count
FROM   app_user u
WHERE  EXISTS (
    SELECT 1 FROM notification n
    WHERE  n.user_id = u.user_id AND n.read_at IS NULL
)
ORDER  BY unread_count DESC;

-- D7. CORRELATED SUBQUERY: matches that are stronger than usual for that reference case.
--     The inner query is re-evaluated for every outer row, because it refers to the
--     outer row's m.reference_case_id: "average similarity of THIS case across all matches".
SELECT r.title                                   AS reference_case,
       m.assessment_id,
       m.match_rank,
       round(m.similarity_score::numeric, 4)     AS similarity,
       round((SELECT avg(m2.similarity_score)
              FROM   screening_match m2
              WHERE  m2.reference_case_id = m.reference_case_id)::numeric, 4)
                                                 AS case_avg_similarity
FROM   screening_match m
JOIN   reference_fraud_case r ON r.case_id = m.reference_case_id
WHERE  m.similarity_score > (
           SELECT avg(m2.similarity_score)
           FROM   screening_match m2
           WHERE  m2.reference_case_id = m.reference_case_id   -- correlation
       )
ORDER  BY r.title, similarity DESC;

-- =============================================================================
-- SECTION E — CTEs (Common Table Expressions)
-- =============================================================================

-- E1. Full claim lifecycle: latest screening + review + decision in one view
WITH latest_assessment AS (
    SELECT DISTINCT ON (claim_id)
           claim_id,
           assessment_id,
           attempt_no,
           status      AS screening_status,
           outcome,
           risk_indicator
    FROM   screening_assessment
    ORDER  BY claim_id, attempt_no DESC
),
latest_review AS (
    SELECT DISTINCT ON (claim_id)
           claim_id,
           review_action AS last_review_action,
           reviewed_at   AS last_reviewed_at
    FROM   review
    ORDER  BY claim_id, reviewed_at DESC
),
decision_info AS (
    SELECT claim_id, decision_status, decided_at
    FROM   claim_decision
)
SELECT c.claim_id,
       u.full_name        AS claimant,
       c.claim_status,
       la.risk_indicator,
       lr.last_review_action,
       di.decision_status,
       di.decided_at::date
FROM   claim c
JOIN   app_user u    ON u.user_id    = c.claimant_id
LEFT JOIN latest_assessment la ON la.claim_id = c.claim_id
LEFT JOIN latest_review     lr ON lr.claim_id = c.claim_id
LEFT JOIN decision_info      di ON di.claim_id = c.claim_id
ORDER  BY c.submitted_at DESC;

-- E2. Fraud pattern heat map: which reference cases co-occur in the same assessment
WITH pair_counts AS (
    SELECT m1.reference_case_id AS case_a,
           m2.reference_case_id AS case_b,
           count(*)              AS co_occurrence_count
    FROM   screening_match m1
    JOIN   screening_match m2
        ON  m1.assessment_id = m2.assessment_id
        AND m1.reference_case_id < m2.reference_case_id
    GROUP  BY m1.reference_case_id, m2.reference_case_id
)
SELECT r1.title AS case_a_title,
       r2.title AS case_b_title,
       pc.co_occurrence_count
FROM   pair_counts pc
JOIN   reference_fraud_case r1 ON r1.case_id = pc.case_a
JOIN   reference_fraud_case r2 ON r2.case_id = pc.case_b
ORDER  BY co_occurrence_count DESC;

-- E3. High-risk claim pipeline: open HIGH-risk claims with age and review status
WITH high_risk_claims AS (
    SELECT c.claim_id,
           c.claimed_amount,
           c.submitted_at,
           floor(extract(epoch FROM (now() - c.submitted_at)) / 3600)::int AS age_hours
    FROM   claim c
    WHERE  c.review_required AND c.claim_status <> 'DECIDED'
),
last_review AS (
    SELECT DISTINCT ON (claim_id)
           claim_id, review_action, reviewed_at
    FROM   review
    ORDER  BY claim_id, reviewed_at DESC
)
SELECT hr.claim_id,
       hr.claimed_amount,
       hr.age_hours,
       COALESCE(lr.review_action, 'NOT_STARTED') AS current_review_state,
       lr.reviewed_at
FROM   high_risk_claims hr
LEFT JOIN last_review lr ON lr.claim_id = hr.claim_id
ORDER  BY hr.age_hours DESC;

-- E4. RECURSIVE CTE: monthly claim trend with zero-filled months.
--     C6 groups claims by month, so a month with no claims simply disappears.
--     Here WITH RECURSIVE generates every month from the first to the last submission
--     (anchor = first month; recursive step = previous month + 1, stopping at the last
--     month), and a LEFT JOIN keeps months with 0 claims visible in the trend.
WITH RECURSIVE months (month_start, last_month) AS (
    -- anchor member: the first month that has a claim
    SELECT date_trunc('month', min(submitted_at))::date,
           date_trunc('month', max(submitted_at))::date
    FROM   claim
    UNION ALL
    -- recursive member: next month, until the last month with a claim
    SELECT (month_start + interval '1 month')::date,
           last_month
    FROM   months
    WHERE  month_start < last_month
)
SELECT m.month_start                                  AS month,
       count(c.claim_id)                              AS claims_submitted,
       coalesce(sum(c.claimed_amount), 0)             AS total_claimed,
       count(c.claim_id) FILTER (WHERE c.review_required) AS high_risk_flagged
FROM   months m
LEFT JOIN claim c
       ON date_trunc('month', c.submitted_at)::date = m.month_start
GROUP  BY m.month_start
ORDER  BY m.month_start;

-- E4b. Ordered audit trail for one claim (non-recursive CTE + ROW_NUMBER).
--     Columns match audit_log: occurred_at, action, actor_id, claim_id, details.
WITH claim_events AS (
    SELECT al.occurred_at,
           al.audit_id,
           al.action,
           al.actor_type,
           COALESCE(actor.full_name, 'SYSTEM') AS actor,
           al.details
    FROM   audit_log al
    LEFT JOIN app_user actor ON actor.user_id = al.actor_id
    WHERE  al.claim_id = 'd1000000-0000-0000-0000-000000000001'
)
SELECT row_number() OVER (ORDER BY occurred_at, audit_id) AS step,
       occurred_at,
       action,
       actor_type,
       actor,
       details
FROM   claim_events
ORDER  BY step;

-- E5. Policy utilization: policies with claim count, total exposure, and decision rate
WITH policy_stats AS (
    SELECT p.policy_id,
           p.policy_number,
           u.full_name                   AS holder,
           count(c.claim_id)             AS claims_filed,
           coalesce(sum(c.claimed_amount), 0) AS total_exposure,
           count(cd.decision_id)         AS decisions_made
    FROM   policy p
    JOIN   app_user u ON u.user_id = p.holder_id
    LEFT JOIN claim c          ON c.policy_id  = p.policy_id
    LEFT JOIN claim_decision cd ON cd.claim_id = c.claim_id
    GROUP  BY p.policy_id, p.policy_number, u.full_name
)
SELECT *,
       CASE WHEN claims_filed = 0 THEN 'NO_CLAIMS'
            WHEN decisions_made = claims_filed THEN 'FULLY_DECIDED'
            ELSE 'IN_PROGRESS'
       END AS status_label
FROM   policy_stats
ORDER  BY total_exposure DESC;

-- =============================================================================
-- SECTION F — Window functions
-- =============================================================================

-- F1. Rank claims by amount within each claimant using RANK()
SELECT u.full_name  AS claimant,
       c.claim_id,
       c.claimed_amount,
       RANK() OVER (PARTITION BY c.claimant_id ORDER BY c.claimed_amount DESC) AS amount_rank
FROM   claim c
JOIN   app_user u ON u.user_id = c.claimant_id
ORDER  BY u.full_name, amount_rank;

-- F2. Running total of claimed amounts ordered by submission date
SELECT c.claim_id,
       u.full_name        AS claimant,
       c.submitted_at::date,
       c.claimed_amount,
       SUM(c.claimed_amount) OVER (ORDER BY c.submitted_at
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                           AS running_total
FROM   claim c
JOIN   app_user u ON u.user_id = c.claimant_id
ORDER  BY c.submitted_at;

-- F3. Similarity score ranked within each assessment — top match highlighted
SELECT a.claim_id,
       m.match_rank,
       r.title             AS matched_case,
       round(m.similarity_score::numeric, 4) AS similarity,
       CASE WHEN ROW_NUMBER() OVER (PARTITION BY m.assessment_id ORDER BY m.similarity_score DESC) = 1
            THEN 'TOP MATCH'
            ELSE ''
       END AS top_match_flag
FROM   screening_match m
JOIN   screening_assessment a ON a.assessment_id = m.assessment_id
JOIN   reference_fraud_case r ON r.case_id       = m.reference_case_id
ORDER  BY a.claim_id, m.match_rank;

-- F4. LAG/LEAD: compare each claim's amount to the previous and next submission
SELECT c.claim_id,
       u.full_name        AS claimant,
       c.submitted_at::date,
       c.claimed_amount,
       LAG (c.claimed_amount) OVER (ORDER BY c.submitted_at) AS prev_claim_amount,
       LEAD(c.claimed_amount) OVER (ORDER BY c.submitted_at) AS next_claim_amount,
       c.claimed_amount
         - LAG(c.claimed_amount, 1, c.claimed_amount) OVER (ORDER BY c.submitted_at)
                                                            AS delta_from_prev
FROM   claim c
JOIN   app_user u ON u.user_id = c.claimant_id
ORDER  BY c.submitted_at;

-- F5. DENSE_RANK on similarity: global leaderboard of most suspicious matches
SELECT m.assessment_id,
       r.title             AS case_matched,
       round(m.similarity_score::numeric, 4) AS similarity,
       DENSE_RANK() OVER (ORDER BY m.similarity_score DESC) AS global_rank
FROM   screening_match m
JOIN   reference_fraud_case r ON r.case_id = m.reference_case_id
ORDER  BY global_rank
LIMIT  10;

-- F6. NTILE: bucket claims into quartiles by amount
SELECT c.claim_id,
       u.full_name     AS claimant,
       c.claimed_amount,
       NTILE(4) OVER (ORDER BY c.claimed_amount) AS amount_quartile
FROM   claim c
JOIN   app_user u ON u.user_id = c.claimant_id
ORDER  BY c.claimed_amount;

-- F7. First and last screening attempt per claim using FIRST_VALUE / LAST_VALUE
SELECT DISTINCT ON (a.claim_id)
       a.claim_id,
       FIRST_VALUE(a.attempt_no)    OVER w AS first_attempt,
       LAST_VALUE (a.attempt_no)    OVER w AS last_attempt,
       FIRST_VALUE(a.status)        OVER w AS first_status,
       LAST_VALUE (a.status)        OVER w AS final_status
FROM   screening_assessment a
WINDOW w AS (PARTITION BY a.claim_id ORDER BY a.attempt_no
             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING);

-- =============================================================================
-- SECTION G — Project-specific queries
-- =============================================================================

-- G1. FRAUD SCREENING EVIDENCE REPORT
--     Full evidence card for a single claim: claim details, risk indicator,
--     embedding model, all matches with similarity scores, and review chain.
SELECT
    'CLAIM'             AS section,
    c.claim_id::text    AS identifier,
    u.full_name         AS party,
    c.claimed_amount::text AS amount,
    c.claim_status      AS status,
    NULL                AS detail
FROM   claim c JOIN app_user u ON u.user_id = c.claimant_id
WHERE  c.claim_id = 'd1000000-0000-0000-0000-000000000001'

UNION ALL

SELECT
    'SCREENING'                     AS section,
    a.assessment_id::text           AS identifier,
    a.risk_indicator                AS party,
    a.risk_rule_version             AS amount,
    a.status                        AS status,
    a.similarity_metric             AS detail
FROM   screening_assessment a
WHERE  a.claim_id = 'd1000000-0000-0000-0000-000000000001'
ORDER  BY section;

-- G2. REVIEW QUEUE — open claims requiring adjuster attention
--     (Uses the built-in view; shown here as the underlying query for clarity)
SELECT c.claim_id,
       p.policy_number,
       u.full_name        AS claimant,
       c.claimed_amount,
       c.claim_status,
       c.screening_status,
       c.review_required,
       a.risk_indicator,
       a.risk_rule_version,
       c.submitted_at,
       extract(epoch FROM (now() - c.submitted_at)) / 3600
                          AS age_hours
FROM   claim c
JOIN   policy   p  ON p.policy_id  = c.policy_id
JOIN   app_user u  ON u.user_id    = c.claimant_id
LEFT JOIN LATERAL (
    SELECT risk_indicator, risk_rule_version, status
    FROM   screening_assessment
    WHERE  claim_id = c.claim_id
    ORDER  BY attempt_no DESC LIMIT 1
) a ON true
WHERE  c.claim_status <> 'DECIDED'
ORDER  BY c.review_required DESC, c.submitted_at ASC;

-- G3. ACTIVE RISK RULE LOOKUP
--     Returns the currently active rule with thresholds.
SELECT rule_version,
       is_active,
       (definition->>'high_similarity_threshold')::numeric   AS high_threshold,
       (definition->>'medium_similarity_threshold')::numeric AS medium_threshold,
       (definition->>'description')                          AS description
FROM   risk_rule
WHERE  is_active;

-- G4. fn_compute_claim_risk USAGE DEMO
--     Compute advisory risk for each completed assessment using the active rule.
SELECT a.assessment_id,
       a.claim_id,
       a.risk_indicator                          AS stored_indicator,
       fn_compute_claim_risk(a.assessment_id)    AS computed_indicator
FROM   screening_assessment a
WHERE  a.status = 'COMPLETED';

-- G5. COSINE SIMILARITY VECTOR SEARCH
--     Retrieve the top-3 active reference cases most similar to a given embedding.
--     In production the query vector comes from the embedding service.
--     Here we use Claim 1's stored description embedding as the probe.
SELECT r.case_id,
       r.title,
       round((1 - (r.embedding <=> a.description_embedding))::numeric, 4) AS cosine_similarity
FROM   reference_fraud_case r,
       screening_assessment a
WHERE  r.is_active AND r.is_confirmed
  AND  r.embedding_model_id = a.embedding_model_id
  AND  a.assessment_id = 'e1000000-0000-0000-0000-000000000001'
ORDER  BY r.embedding <=> a.description_embedding
LIMIT  3;

-- G6. CLAIM DECISION AUDIT — verify no claim was decided without a completed screening
SELECT c.claim_id,
       c.claim_status,
       c.screening_status,
       cd.decision_status,
       a.status  AS assessment_status,
       a.outcome AS assessment_outcome
FROM   claim_decision cd
JOIN   claim c ON c.claim_id = cd.claim_id
JOIN   review rv ON rv.review_id = cd.review_id
LEFT JOIN screening_assessment a ON a.assessment_id = rv.assessment_id
ORDER  BY cd.decided_at;

-- G7. STALE PENDING SCREENING (built-in view result)
--     Claims that have been pending screening for more than 15 minutes.
SELECT * FROM v_stale_pending_screening;

-- G8. REPORTING VIEWS — results from all five pre-built views
SELECT 'v_claim_status_summary'   AS view_name, claim_status::text AS col1,
       screening_status::text AS col2, claim_count::text AS col3,
       review_required::text AS col4
FROM   v_claim_status_summary;

SELECT 'v_adjuster_workload' AS view_name, reviewer_id::text AS adjuster_id,
       review_count::text, approvals::text, rejections::text
FROM   v_adjuster_workload;

SELECT 'v_reference_match_frequency' AS view_name, title,
       match_count::text, round(average_similarity::numeric,4)::text AS avg_sim
FROM   v_reference_match_frequency;

SELECT 'v_high_risk_aged_queue' AS view_name, claim_id::text, claimed_amount::text,
       age_hours::text
FROM   v_high_risk_aged_queue;

SELECT 'v_risk_distribution_over_time' AS view_name, assessment_day::text,
       risk_indicator, assessment_count::text
FROM   v_risk_distribution_over_time;

-- G15. COMPLETE TABLE ROW COUNTS — verify all 14 tables are populated
SELECT
    relname AS tablename,
    n_live_tup AS estimated_row_count
FROM pg_stat_user_tables
ORDER BY relname;

-- =============================================================================
-- SECTION H — Transactions and stored procedures (requires migration 002)
-- =============================================================================
-- H1–H3 leave the database unchanged: every change they make is rolled back.

-- H1. FOREIGN KEY CHECK — a screening cannot name a risk-rule version that does not exist
--     (fk_assessment_risk_rule_version, enforced by migration 002).
DO $$
BEGIN
  BEGIN
    INSERT INTO screening_assessment
      (claim_id, attempt_no, status, outcome, risk_indicator, risk_rule_version,
       embedding_model_id, description_embedding, top_k, similarity_metric)
    SELECT 'd1000000-0000-0000-0000-000000000006', 99, 'COMPLETED', 'NO_MATCH', 'LOW', 'v9.9-missing',
           1, embedding, 3, 'cosine_similarity'
    FROM   reference_fraud_case WHERE case_id = 'c1000000-0000-0000-0000-000000000001';
    RAISE NOTICE 'FAIL: unknown risk_rule_version was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: unknown rule version rejected (%): %', SQLSTATE, SQLERRM;
  END;
END $$;

-- H2. ATOMICITY ON FAILURE — sp_decide_claim is all-or-nothing.
--     (a) Approving claim 4, whose only screening FAILED, is blocked by fn_assert_approvable.
--     (b) Rejecting claim 3 succeeds (review + decision + notification + 2 audit rows), then a
--         later step in the same transaction fails. The exception handler rolls the whole
--         block back to its savepoint, so the audit rows written by the triggers vanish too.
DO $$
DECLARE
  v_audit_before  bigint;  v_audit_after  bigint;
  v_review_before bigint;  v_review_after bigint;
  v_notif_before  bigint;  v_notif_after  bigint;
  v_status        text;
  v_review uuid; v_decision uuid; v_notification uuid;
BEGIN
  -- (a) blocked approval
  SELECT count(*) INTO v_audit_before  FROM audit_log    WHERE claim_id = 'd1000000-0000-0000-0000-000000000004';
  SELECT count(*) INTO v_review_before FROM review       WHERE claim_id = 'd1000000-0000-0000-0000-000000000004';
  BEGIN
    CALL sp_decide_claim('d1000000-0000-0000-0000-000000000004',
                         'a2000000-0000-0000-0000-000000000001',
                         'APPROVED', 'Attempting approval while screening has FAILED.',
                         v_review, v_decision, v_notification);
    RAISE NOTICE 'FAIL: approval of a FAILED-screening claim was accepted';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'H2a blocked as expected (%): %', SQLSTATE, SQLERRM;
  END;
  SELECT count(*) INTO v_audit_after  FROM audit_log WHERE claim_id = 'd1000000-0000-0000-0000-000000000004';
  SELECT count(*) INTO v_review_after FROM review    WHERE claim_id = 'd1000000-0000-0000-0000-000000000004';
  RAISE NOTICE 'H2a %: audit rows % -> %, reviews % -> %',
    CASE WHEN v_audit_before = v_audit_after AND v_review_before = v_review_after THEN 'PASS' ELSE 'FAIL' END,
    v_audit_before, v_audit_after, v_review_before, v_review_after;

  -- (b) success followed by a later failure in the same unit of work
  SELECT count(*) INTO v_audit_before  FROM audit_log    WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_review_before FROM review       WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_notif_before  FROM notification WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
  BEGIN
    CALL sp_decide_claim('d1000000-0000-0000-0000-000000000003',
                         'a2000000-0000-0000-0000-000000000003',
                         'REJECTED', 'Hospital records could not be verified.',
                         v_review, v_decision, v_notification);
    RAISE NOTICE 'H2b inside the unit: review %, decision %, audit rows now %',
      v_review, v_decision,
      (SELECT count(*) FROM audit_log WHERE claim_id = 'd1000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'simulated failure of a later step (e.g. payment service)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'H2b rolled back after: %', SQLERRM;
  END;
  SELECT count(*) INTO v_audit_after  FROM audit_log    WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_review_after FROM review       WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_notif_after  FROM notification WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
  SELECT claim_status INTO v_status FROM claim WHERE claim_id = 'd1000000-0000-0000-0000-000000000003';
  RAISE NOTICE 'H2b %: audit % -> %, reviews % -> %, notifications % -> %, claim_status %',
    CASE WHEN v_audit_before = v_audit_after AND v_review_before = v_review_after
              AND v_notif_before = v_notif_after AND v_status <> 'DECIDED' THEN 'PASS' ELSE 'FAIL' END,
    v_audit_before, v_audit_after, v_review_before, v_review_after,
    v_notif_before, v_notif_after, v_status;
END $$;

-- H3. EXPLICIT ROLLBACK — BEGIN; CALL sp_decide_claim(...); ROLLBACK;
--     Inside the transaction the review, decision, notification and audit rows exist.
--     After ROLLBACK the claim is back to AWAITING_INFO and the audit count is unchanged.
SELECT 'before BEGIN' AS stage,
       (SELECT claim_status FROM claim WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS claim_status,
       (SELECT count(*) FROM audit_log      WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS audit_rows,
       (SELECT count(*) FROM claim_decision WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS decisions,
       (SELECT count(*) FROM notification   WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS notifications;

BEGIN;
CALL sp_decide_claim('d1000000-0000-0000-0000-000000000003',
                     'a2000000-0000-0000-0000-000000000003',
                     'REJECTED', 'Hospital records could not be verified.');
SELECT 'inside transaction' AS stage,
       (SELECT claim_status FROM claim WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS claim_status,
       (SELECT count(*) FROM audit_log      WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS audit_rows,
       (SELECT count(*) FROM claim_decision WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS decisions,
       (SELECT count(*) FROM notification   WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS notifications;
ROLLBACK;

SELECT 'after ROLLBACK' AS stage,
       (SELECT claim_status FROM claim WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS claim_status,
       (SELECT count(*) FROM audit_log      WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS audit_rows,
       (SELECT count(*) FROM claim_decision WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS decisions,
       (SELECT count(*) FROM notification   WHERE claim_id = 'd1000000-0000-0000-0000-000000000003') AS notifications;
