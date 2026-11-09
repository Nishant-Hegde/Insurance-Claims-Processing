import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { cleanText, dbErrorResponse, isUuid, jsonError, readJsonObject } from "@/app/lib/http";

const ACTIONS = ["APPROVED", "REJECTED", "INFO_REQUESTED"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/claims/[id]/review   (CLAIMS_ADJUSTER)
 * body: { action: "APPROVED" | "REJECTED" | "INFO_REQUESTED", notes }
 *
 *   BEGIN;
 *   CALL sp_decide_claim(claim, reviewer, action, notes);   -- migration 002
 *   COMMIT;            -- or ROLLBACK on any error: nothing is half-written
 *
 * The procedure writes the review, the claim_decision (approve/reject) and the
 * policyholder notification; triggers add the audit rows. Approval is checked by the
 * database (fn_assert_approvable, extended in migration 004): a failed screening or an
 * unresolved HIGH-risk claim is refused there, and the message is shown to the adjuster.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireRole("CLAIMS_ADJUSTER");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Claim not found.");

  const body = await readJsonObject(request);
  const action = body?.action as Action;
  if (!ACTIONS.includes(action)) return jsonError(400, "Choose approve, reject or request information.");
  const notes = cleanText(body?.notes, 10, 2000);
  if (!notes) {
    return jsonError(400, action === "INFO_REQUESTED"
      ? "Write the question for the policyholder (10 to 2000 characters)."
      : "Write your reasoning (10 to 2000 characters).");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('claimguard.actor_id', $1, true)", [auth.user.userId]);
    const { rows } = await client.query<{
      p_review_id: string;
      p_decision_id: string | null;
      p_notification_id: string;
    }>(
      `CALL sp_decide_claim($1::uuid, $2::uuid, $3::varchar, $4::text, NULL, NULL, NULL)`,
      [id, auth.user.userId, action, notes]
    );
    await client.query("COMMIT");
    return NextResponse.json({
      reviewId: rows[0].p_review_id,
      decisionId: rows[0].p_decision_id,
      notificationId: rows[0].p_notification_id,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((err as { message?: string }).message?.includes("does not exist")) {
      return jsonError(404, "Claim not found.");
    }
    return dbErrorResponse(err, "POST /api/claims/[id]/review");
  } finally {
    client.release();
  }
}
