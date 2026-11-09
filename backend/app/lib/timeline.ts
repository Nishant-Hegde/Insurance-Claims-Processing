/**
 * Claim status timeline for the policyholder (server-only).
 * One UNION ALL over five tables, ordered by time. It deliberately leaves out fraud
 * evidence: no risk level, no matches, and no adjuster notes except the question in an
 * information request (which the policyholder must answer).
 */
import pool from "@/app/db/pool";

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
}

export async function claimTimeline(claimId: string): Promise<TimelineEvent[]> {
  const { rows } = await pool.query<{ at: Date; kind: string; title: string; detail: string | null }>(
    `SELECT at, kind, title, detail FROM (
        SELECT c.submitted_at AS at, 'SUBMITTED' AS kind, 'Claim submitted' AS title,
               NULL::text AS detail, 1 AS ord
        FROM claim c WHERE c.claim_id = $1
      UNION ALL
        SELECT a.created_at, 'SCREENING',
               CASE WHEN a.status = 'COMPLETED' THEN 'Automatic check completed'
                    ELSE 'Automatic check could not run; it will be retried' END,
               NULL, 2
        FROM screening_assessment a WHERE a.claim_id = $1
      UNION ALL
        SELECT r.reviewed_at, 'REVIEW_' || r.review_action,
               CASE r.review_action
                    WHEN 'INFO_REQUESTED' THEN 'An adjuster asked for more information'
                    WHEN 'APPROVED'       THEN 'An adjuster approved the claim'
                    ELSE                       'An adjuster rejected the claim' END,
               CASE WHEN r.review_action = 'INFO_REQUESTED' THEN r.notes END, 3
        FROM review r WHERE r.claim_id = $1
      UNION ALL
        SELECT ir.responded_at, 'RESPONSE', 'You sent the requested information', ir.body, 4
        FROM information_response ir WHERE ir.claim_id = $1
      UNION ALL
        SELECT d.decided_at, 'DECISION',
               'Final decision: ' || lower(d.decision_status), NULL, 5
        FROM claim_decision d WHERE d.claim_id = $1
     ) t
     ORDER BY at, ord`,
    [claimId]
  );
  return rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    title: r.title,
    detail: r.detail,
  }));
}

export interface OutstandingRequest {
  reviewId: string;
  question: string;
  requestedAt: string;
}

/**
 * The request the policyholder still has to answer: the claim's latest review is
 * INFO_REQUESTED, it has no response yet, and the claim is AWAITING_INFO.
 * (trg_information_response_guard re-checks all of this on INSERT.)
 */
export async function outstandingRequest(claimId: string): Promise<OutstandingRequest | null> {
  const { rows } = await pool.query<{ review_id: string; notes: string; reviewed_at: Date }>(
    `SELECT r.review_id, r.notes, r.reviewed_at
     FROM claim c
     JOIN LATERAL (
         SELECT review_id, review_action, notes, reviewed_at
         FROM review WHERE claim_id = c.claim_id
         ORDER BY reviewed_at DESC, review_id DESC LIMIT 1
     ) r ON true
     WHERE c.claim_id = $1
       AND c.claim_status = 'AWAITING_INFO'
       AND r.review_action = 'INFO_REQUESTED'
       AND NOT EXISTS (SELECT 1 FROM information_response ir WHERE ir.review_id = r.review_id)`,
    [claimId]
  );
  const r = rows[0];
  return r ? { reviewId: r.review_id, question: r.notes, requestedAt: new Date(r.reviewed_at).toISOString() } : null;
}
