import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { cleanText, dbErrorResponse, isIsoDate, isUuid, jsonError, readJsonObject } from "@/app/lib/http";

/**
 * POST /api/admin/policies   (ADMIN)
 * body: { holderId, policyNumber, effectiveDate, expiryDate }
 * The database enforces the rest: unique policy_number, expiry > effective (CHECK),
 * holder must be an active POLICYHOLDER (trg_policy_holder_role), and
 * trg_policy_issuance_audit writes POLICY_ISSUED with this admin as the actor.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireRole("ADMIN");
  if ("response" in auth) return auth.response;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, "Send a JSON object.");
  const policyNumber = cleanText(body.policyNumber, 3, 40)?.toUpperCase() ?? null;
  if (!isUuid(body.holderId)) return jsonError(400, "Choose a policyholder.");
  if (!policyNumber || !/^[A-Z0-9-]+$/.test(policyNumber)) {
    return jsonError(400, "Policy number: 3 to 40 letters, digits or dashes.");
  }
  if (!isIsoDate(body.effectiveDate) || !isIsoDate(body.expiryDate)) {
    return jsonError(400, "Effective and expiry dates must be valid dates.");
  }
  if (body.expiryDate <= body.effectiveDate) {
    return jsonError(400, "The expiry date must be after the effective date.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('claimguard.actor_id', $1, true)", [auth.user.userId]);
    const { rows } = await client.query<{ policy_id: string }>(
      `INSERT INTO policy (policy_number, holder_id, effective_date, expiry_date)
       VALUES ($1, $2, $3::date, $4::date)
       RETURNING policy_id`,
      [policyNumber, body.holderId, body.effectiveDate, body.expiryDate]
    );
    await client.query("COMMIT");
    return NextResponse.json({ policyId: rows[0].policy_id, policyNumber }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    return dbErrorResponse(err, "POST /api/admin/policies");
  } finally {
    client.release();
  }
}
