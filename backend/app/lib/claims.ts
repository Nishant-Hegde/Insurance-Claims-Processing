/**
 * Role-aware claim detail (server-only), used by GET /api/claims/[id] and /claims/[id].
 *
 * - POLICYHOLDER: only their own claim (others look like "not found"), and no fraud
 *   evidence: no risk indicator, no matches, no reference cases, no failure reasons.
 * - CLAIMS_ADJUSTER / ADMIN: every screening attempt with its ranked matches,
 *   similarity scores and reference-case titles.
 */
import pool from "@/app/db/pool";
import type { SessionUser } from "@/app/types";

export interface ClaimMatch {
  rank: number;
  similarity: number;
  referenceCaseId: string;
  title: string;
  caseActive: boolean;
}

export interface ClaimAssessment {
  assessmentId: string;
  attemptNo: number;
  status: "COMPLETED" | "FAILED";
  outcome: string | null;
  riskIndicator: string | null;
  riskRuleVersion: string | null;
  failureReason: string | null;
  modelName: string | null;
  modelVersion: string | null;
  topK: number | null;
  createdAt: string;
  matches: ClaimMatch[];
}

export interface ClaimDetail {
  claimId: string;
  policyNumber: string;
  claimantName: string;
  incidentDate: string;
  claimedAmount: number;
  description: string;
  claimStatus: string;
  screeningStatus: string;
  submittedAt: string;
  decisionStatus: string | null;
  /** Staff only. */
  evidence?: {
    reviewRequired: boolean;
    assessments: ClaimAssessment[];
  };
}

export async function getClaimDetail(
  claimId: string,
  user: SessionUser
): Promise<ClaimDetail | null> {
  const ownerFilter = user.role === "POLICYHOLDER" ? user.userId : null;
  const { rows } = await pool.query<{
    claim_id: string;
    policy_number: string;
    full_name: string;
    incident_date: string;
    claimed_amount: string;
    description: string;
    claim_status: string;
    screening_status: string;
    review_required: boolean;
    submitted_at: Date;
    decision_status: string | null;
  }>(
    `SELECT c.claim_id, p.policy_number, u.full_name,
            to_char(c.incident_date, 'YYYY-MM-DD') AS incident_date,
            c.claimed_amount, c.description, c.claim_status, c.screening_status,
            c.review_required, c.submitted_at, d.decision_status
     FROM claim c
     JOIN policy p   ON p.policy_id = c.policy_id
     JOIN app_user u ON u.user_id   = c.claimant_id
     LEFT JOIN claim_decision d ON d.claim_id = c.claim_id
     WHERE c.claim_id = $1
       AND ($2::uuid IS NULL OR c.claimant_id = $2::uuid)`,
    [claimId, ownerFilter]
  );
  const c = rows[0];
  if (!c) return null;

  const detail: ClaimDetail = {
    claimId: c.claim_id,
    policyNumber: c.policy_number,
    claimantName: c.full_name,
    incidentDate: c.incident_date,
    claimedAmount: Number(c.claimed_amount),
    description: c.description,
    claimStatus: c.claim_status,
    screeningStatus: c.screening_status,
    submittedAt: new Date(c.submitted_at).toISOString(),
    decisionStatus: c.decision_status,
  };
  if (user.role === "POLICYHOLDER") return detail;

  const { rows: attempts } = await pool.query<{
    assessment_id: string;
    attempt_no: number;
    status: "COMPLETED" | "FAILED";
    outcome: string | null;
    risk_indicator: string | null;
    risk_rule_version: string | null;
    failure_reason: string | null;
    model_name: string | null;
    model_version: string | null;
    top_k: number | null;
    created_at: Date;
    matches: ClaimMatch[] | null;
  }>(
    `SELECT a.assessment_id, a.attempt_no, a.status, a.outcome, a.risk_indicator,
            a.risk_rule_version, a.failure_reason, em.model_name, em.model_version,
            a.top_k, a.created_at,
            (SELECT json_agg(json_build_object(
                        'rank', m.match_rank,
                        'similarity', m.similarity_score,
                        'referenceCaseId', r.case_id,
                        'title', r.title,
                        'caseActive', r.is_active)
                    ORDER BY m.match_rank)
             FROM screening_match m
             JOIN reference_fraud_case r ON r.case_id = m.reference_case_id
             WHERE m.assessment_id = a.assessment_id) AS matches
     FROM screening_assessment a
     LEFT JOIN embedding_model em ON em.model_id = a.embedding_model_id
     WHERE a.claim_id = $1
     ORDER BY a.attempt_no DESC`,
    [claimId]
  );

  detail.evidence = {
    reviewRequired: c.review_required,
    assessments: attempts.map((a) => ({
      assessmentId: a.assessment_id,
      attemptNo: a.attempt_no,
      status: a.status,
      outcome: a.outcome,
      riskIndicator: a.risk_indicator,
      riskRuleVersion: a.risk_rule_version,
      failureReason: a.failure_reason,
      modelName: a.model_name,
      modelVersion: a.model_version,
      topK: a.top_k,
      createdAt: new Date(a.created_at).toISOString(),
      matches: a.matches ?? [],
    })),
  };
  return detail;
}
