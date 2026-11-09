import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { cleanText, dbErrorResponse, isUuid, jsonError, readJsonObject } from "@/app/lib/http";
import { outstandingRequest } from "@/app/lib/timeline";

/**
 * POST /api/claims/[id]/responses   (POLICYHOLDER)
 * body: { body: "..." }
 * Answers the claim's outstanding information request. The API finds that request, but
 * the database is what enforces the rule (trg_information_response_guard, migration 004):
 * only this claim's policyholder, only the latest unanswered INFO_REQUESTED review.
 * After the insert, triggers move the claim back to UNDER_REVIEW, notify the adjuster,
 * and write INFORMATION_RESPONSE_ADDED to the audit log, all in this transaction.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireRole("POLICYHOLDER");
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Claim not found.");

  const body = await readJsonObject(request);
  const text = cleanText(body?.body, 10, 5000);
  if (!text) return jsonError(400, "Write your answer in 10 to 5000 characters.");

  const owned = await pool.query(`SELECT 1 FROM claim WHERE claim_id = $1 AND claimant_id = $2`, [id, user.userId]);
  if (owned.rowCount === 0) return jsonError(404, "Claim not found.");

  const pending = await outstandingRequest(id);
  if (!pending) return jsonError(409, "There is no open information request on this claim.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('claimguard.actor_id', $1, true)", [user.userId]);
    const { rows } = await client.query<{ response_id: string }>(
      `INSERT INTO information_response (review_id, claim_id, responder_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING response_id`,
      [pending.reviewId, id, user.userId, text]
    );
    await client.query("COMMIT");
    return NextResponse.json({ responseId: rows[0].response_id }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    return dbErrorResponse(err, "POST /api/claims/[id]/responses");
  } finally {
    client.release();
  }
}
