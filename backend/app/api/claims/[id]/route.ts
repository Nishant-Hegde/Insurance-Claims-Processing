import { NextResponse } from "next/server";
import { requireRole } from "@/app/lib/auth";
import { getClaimDetail } from "@/app/lib/claims";
import { dbErrorResponse, isUuid, jsonError } from "@/app/lib/http";

/**
 * GET /api/claims/[id]
 * Policyholders: their own claim only, without fraud evidence.
 * Adjusters/admins: plus every screening attempt with ranked matches.
 * Someone else's claim returns 404 (not 403), so claim ids cannot be probed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireRole("POLICYHOLDER", "CLAIMS_ADJUSTER", "ADMIN");
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Claim not found.");

  try {
    const claim = await getClaimDetail(id, auth.user);
    if (!claim) return jsonError(404, "Claim not found.");
    return NextResponse.json({ claim });
  } catch (err) {
    return dbErrorResponse(err, "GET /api/claims/[id]");
  }
}
