/**
 * Runs one screening attempt for a claim (server-only).
 *
 *   1. Ask the embedding service for the description's vector (outside any transaction:
 *      a slow network call must not hold database locks).
 *   2. BEGIN; CALL sp_screen_claim(...); COMMIT  (migration 002)
 *
 * If the service is down, or its model is not registered in embedding_model, the procedure
 * is still called, with a failure reason: it stores a FAILED attempt, never a LOW risk.
 */
import pool from "@/app/db/pool";
import {
  embedText,
  EmbeddingUnavailableError,
  findModelId,
  toPgVector,
} from "@/app/lib/embedding";

export const SCREENING_TOP_K = Math.min(
  Math.max(Number(process.env.SCREENING_TOP_K ?? 5) || 5, 1),
  40
);

export interface ScreeningResult {
  assessmentId: string;
  attemptNo: number;
  status: "COMPLETED" | "FAILED";
  outcome: "MATCHES_FOUND" | "NO_MATCH" | null;
  riskIndicator: string | null;
  riskRuleVersion: string | null;
  topSimilarity: number | null;
  failureReason: string | null;
}

/**
 * @param actorUserId staff member who asked for a re-screen (recorded in the audit log);
 *                    null for the automatic screening at submission (SYSTEM actor).
 */
export async function screenClaim(
  claimId: string,
  description: string,
  actorUserId: string | null
): Promise<ScreeningResult> {
  let modelId: number | null = null;
  let vector: string | null = null;
  let failure: string | null = null;

  try {
    const embedding = await embedText(description);
    modelId = await findModelId(embedding);
    if (modelId === null) {
      failure = `embedding model ${embedding.modelName} (${embedding.modelVersion}) is not registered in embedding_model`;
    } else {
      vector = toPgVector(embedding.vector);
    }
  } catch (err) {
    if (!(err instanceof EmbeddingUnavailableError)) throw err;
    failure = err.message;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Audit triggers read this setting; local to this transaction only.
    await client.query("SELECT set_config('claimguard.actor_id', $1, true)", [actorUserId ?? ""]);
    const { rows } = await client.query<{ p_assessment_id: string }>(
      `CALL sp_screen_claim($1::uuid, $2::integer, $3::vector, $4::integer, $5::text, NULL, NULL, NULL)`,
      [claimId, failure ? null : modelId, failure ? null : vector, SCREENING_TOP_K, failure]
    );
    await client.query("COMMIT");
    return await loadAssessment(rows[0].p_assessment_id);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function loadAssessment(assessmentId: string): Promise<ScreeningResult> {
  const { rows } = await pool.query<{
    attempt_no: number;
    status: "COMPLETED" | "FAILED";
    outcome: "MATCHES_FOUND" | "NO_MATCH" | null;
    risk_indicator: string | null;
    risk_rule_version: string | null;
    failure_reason: string | null;
    top_similarity: number | null;
  }>(
    `SELECT a.attempt_no, a.status, a.outcome, a.risk_indicator, a.risk_rule_version,
            a.failure_reason,
            (SELECT max(similarity_score) FROM screening_match m
             WHERE m.assessment_id = a.assessment_id) AS top_similarity
     FROM screening_assessment a WHERE a.assessment_id = $1`,
    [assessmentId]
  );
  const r = rows[0];
  return {
    assessmentId,
    attemptNo: r.attempt_no,
    status: r.status,
    outcome: r.outcome,
    riskIndicator: r.risk_indicator,
    riskRuleVersion: r.risk_rule_version,
    topSimilarity: r.top_similarity,
    failureReason: r.failure_reason,
  };
}
