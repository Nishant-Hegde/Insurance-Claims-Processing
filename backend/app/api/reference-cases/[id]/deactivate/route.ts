import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { dbErrorResponse, isUuid, jsonError } from "@/app/lib/http";

/**
 * POST /api/reference-cases/[id]/deactivate   (ADMIN)
 * One-way: the case stops being used for new screenings (the HNSW index only covers
 * active, confirmed cases) but stays as evidence for past matches. The triggers check
 * the deactivator is an ADMIN, forbid reactivation, and write REFERENCE_CASE_DEACTIVATED.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireRole("ADMIN");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Reference case not found.");

  try {
    const { rows } = await pool.query<{ deactivated_at: Date }>(
      `UPDATE reference_fraud_case
       SET    is_active = false, deactivated_by = $2, deactivated_at = now()
       WHERE  case_id = $1 AND is_active
       RETURNING deactivated_at`,
      [id, auth.user.userId]
    );
    if (rows.length === 0) {
      const exists = await pool.query(`SELECT 1 FROM reference_fraud_case WHERE case_id = $1`, [id]);
      return exists.rowCount
        ? jsonError(409, "This reference case is already inactive.")
        : jsonError(404, "Reference case not found.");
    }
    return NextResponse.json({ caseId: id, deactivatedAt: rows[0].deactivated_at });
  } catch (err) {
    return dbErrorResponse(err, "POST /api/reference-cases/[id]/deactivate");
  }
}
