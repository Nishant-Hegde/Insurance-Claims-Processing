/** Extra context for the adjuster's claim page (server-only, staff only). */
import pool from "@/app/db/pool";

export interface CaseFile {
  policy: {
    policyNumber: string;
    effectiveDate: string;
    expiryDate: string;
    isActive: boolean;
    holderName: string;
    holderEmail: string;
    otherClaims: number;
  };
  reviews: {
    reviewId: string;
    action: string;
    notes: string;
    reviewer: string;
    reviewedAt: string;
    attemptNo: number | null;
    response: { body: string; respondedAt: string } | null;
  }[];
}

export async function getCaseFile(claimId: string): Promise<CaseFile | null> {
  const { rows: pol } = await pool.query<{
    policy_number: string;
    effective_date: string;
    expiry_date: string;
    is_active: boolean;
    full_name: string;
    email: string;
    other_claims: number;
  }>(
    `SELECT p.policy_number,
            to_char(p.effective_date, 'YYYY-MM-DD') AS effective_date,
            to_char(p.expiry_date, 'YYYY-MM-DD')    AS expiry_date,
            p.is_active, u.full_name, u.email,
            (SELECT count(*)::int FROM claim o
             WHERE o.policy_id = p.policy_id AND o.claim_id <> c.claim_id) AS other_claims
     FROM claim c
     JOIN policy p   ON p.policy_id = c.policy_id
     JOIN app_user u ON u.user_id   = p.holder_id
     WHERE c.claim_id = $1`,
    [claimId]
  );
  if (pol.length === 0) return null;

  // Review history; each INFO_REQUESTED review with its answer, if any (LEFT JOIN).
  const { rows: reviews } = await pool.query<{
    review_id: string;
    review_action: string;
    notes: string;
    full_name: string;
    reviewed_at: Date;
    attempt_no: number | null;
    body: string | null;
    responded_at: Date | null;
  }>(
    `SELECT r.review_id, r.review_action, r.notes, u.full_name, r.reviewed_at,
            a.attempt_no, ir.body, ir.responded_at
     FROM review r
     JOIN app_user u ON u.user_id = r.reviewer_id
     LEFT JOIN screening_assessment a ON a.assessment_id = r.assessment_id
     LEFT JOIN information_response ir ON ir.review_id = r.review_id
     WHERE r.claim_id = $1
     ORDER BY r.reviewed_at, r.review_id`,
    [claimId]
  );

  const p = pol[0];
  return {
    policy: {
      policyNumber: p.policy_number,
      effectiveDate: p.effective_date,
      expiryDate: p.expiry_date,
      isActive: p.is_active,
      holderName: p.full_name,
      holderEmail: p.email,
      otherClaims: p.other_claims,
    },
    reviews: reviews.map((r) => ({
      reviewId: r.review_id,
      action: r.review_action,
      notes: r.notes,
      reviewer: r.full_name,
      reviewedAt: new Date(r.reviewed_at).toISOString(),
      attemptNo: r.attempt_no,
      response: r.body && r.responded_at ? { body: r.body, respondedAt: new Date(r.responded_at).toISOString() } : null,
    })),
  };
}
