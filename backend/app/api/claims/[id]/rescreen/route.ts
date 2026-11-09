import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { dbErrorResponse, isUuid, jsonError } from "@/app/lib/http";
import { screenClaim } from "@/app/lib/screening";

/**
 * POST /api/claims/[id]/rescreen  (CLAIMS_ADJUSTER, ADMIN)
 * Starts a new screening attempt (next attempt_no) for a claim whose screening FAILED,
 * or never ran (PENDING). The staff member is recorded as the actor in the audit log.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireRole("CLAIMS_ADJUSTER", "ADMIN");
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Claim not found.");

  try {
    const { rows } = await pool.query<{
      description: string;
      claim_status: string;
      screening_status: string;
    }>(
      `SELECT description, claim_status, screening_status FROM claim WHERE claim_id = $1`,
      [id]
    );
    const claim = rows[0];
    if (!claim) return jsonError(404, "Claim not found.");
    if (claim.claim_status === "DECIDED") {
      return jsonError(409, "This claim is already decided.");
    }
    if (claim.screening_status === "COMPLETED") {
      return jsonError(409, "This claim already has a completed screening.");
    }

    const result = await screenClaim(id, claim.description, auth.user.userId);
    return NextResponse.json({ claimId: id, screening: result });
  } catch (err) {
    // e.g. a concurrent re-screen completed first: the procedure raises check_violation
    return dbErrorResponse(err, "POST /api/claims/[id]/rescreen");
  }
}
