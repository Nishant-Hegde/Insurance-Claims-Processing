/**
 * Adjuster review queue (server-only).
 * Built on the reporting views v_review_queue (open claims + latest screening attempt) and
 * v_high_risk_aged_queue (age of flagged claims), with full-text search over claim
 * descriptions that uses the GIN index ix_claim_description_fts and ranks with ts_rank.
 */
import pool from "@/app/db/pool";

export const QUEUE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "AWAITING_INFO"] as const;
export const QUEUE_RISKS = ["HIGH", "MEDIUM", "LOW", "FAILED", "PENDING"] as const;
export const QUEUE_SORTS = {
  oldest: "q.submitted_at ASC",
  newest: "q.submitted_at DESC",
  amount: "q.claimed_amount DESC, q.submitted_at ASC",
  risk: `CASE q.risk_indicator WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END,
         q.submitted_at ASC`,
  relevance: "rank DESC NULLS LAST, q.submitted_at ASC",
} as const;
export type QueueSort = keyof typeof QUEUE_SORTS;

export interface QueueFilters {
  status: (typeof QUEUE_STATUSES)[number] | null;
  risk: (typeof QUEUE_RISKS)[number] | null;
  from: string | null;
  to: string | null;
  flaggedOnly: boolean;
  q: string | null;
  sort: QueueSort;
}

export interface QueueRow {
  claimId: string;
  policyNumber: string;
  claimant: string;
  amount: number;
  claimStatus: string;
  screeningStatus: string;
  reviewRequired: boolean;
  submittedAt: string;
  ageHours: number;
  riskIndicator: string | null;
  riskRuleVersion: string | null;
  excerpt: string;
  /** ts_headline output with <<…>> around matched words (only when searching). */
  headline: string | null;
  rank: number | null;
}

export async function loadQueue(f: QueueFilters): Promise<QueueRow[]> {
  // ORDER BY comes from a fixed whitelist (QUEUE_SORTS); every value is a bind parameter.
  const orderBy = QUEUE_SORTS[f.sort === "relevance" && !f.q ? "oldest" : f.sort];
  const { rows } = await pool.query<{
    claim_id: string;
    policy_number: string;
    claimant: string;
    claimed_amount: string;
    claim_status: string;
    screening_status: string;
    review_required: boolean;
    submitted_at: Date;
    age_hours: string;
    risk_indicator: string | null;
    risk_rule_version: string | null;
    excerpt: string;
    headline: string | null;
    rank: number | null;
  }>(
    `SELECT q.claim_id, p.policy_number, u.full_name AS claimant, q.claimed_amount,
            q.claim_status, q.screening_status, q.review_required, q.submitted_at,
            coalesce(h.age_hours,
                     floor(extract(epoch FROM now() - q.submitted_at) / 3600)::bigint) AS age_hours,
            q.risk_indicator, q.risk_rule_version,
            left(c.description, 160) AS excerpt,
            CASE WHEN $6::text IS NULL THEN NULL
                 ELSE ts_headline('english', c.description, websearch_to_tsquery('english', $6::text),
                                  'StartSel=<<, StopSel=>>, MaxWords=24, MinWords=10') END AS headline,
            CASE WHEN $6::text IS NULL THEN NULL
                 ELSE ts_rank(to_tsvector('english', c.description),
                              websearch_to_tsquery('english', $6::text)) END AS rank
     FROM v_review_queue q
     JOIN claim c    ON c.claim_id  = q.claim_id
     JOIN policy p   ON p.policy_id = q.policy_id
     JOIN app_user u ON u.user_id   = c.claimant_id
     LEFT JOIN v_high_risk_aged_queue h ON h.claim_id = q.claim_id
     WHERE ($1::text IS NULL OR q.claim_status = $1::text)
       AND ($2::text IS NULL OR
            CASE WHEN q.screening_status = 'FAILED'  THEN 'FAILED'
                 WHEN q.screening_status = 'PENDING' THEN 'PENDING'
                 ELSE q.risk_indicator END = $2::text)
       AND ($3::date IS NULL OR q.submitted_at >= $3::date)
       AND ($4::date IS NULL OR q.submitted_at <  $4::date + 1)
       AND (NOT $5::boolean OR q.review_required)
       -- same expression as the GIN index ix_claim_description_fts, so it can be used
       AND ($6::text IS NULL OR to_tsvector('english', c.description)
                                @@ websearch_to_tsquery('english', $6::text))
     ORDER BY ${orderBy}
     LIMIT 200`,
    [f.status, f.risk, f.from, f.to, f.flaggedOnly, f.q]
  );
  return rows.map((r) => ({
    claimId: r.claim_id,
    policyNumber: r.policy_number,
    claimant: r.claimant,
    amount: Number(r.claimed_amount),
    claimStatus: r.claim_status,
    screeningStatus: r.screening_status,
    reviewRequired: r.review_required,
    submittedAt: new Date(r.submitted_at).toISOString(),
    ageHours: Number(r.age_hours),
    riskIndicator: r.risk_indicator,
    riskRuleVersion: r.risk_rule_version,
    excerpt: r.excerpt,
    headline: r.headline,
    rank: r.rank === null ? null : Number(r.rank),
  }));
}
