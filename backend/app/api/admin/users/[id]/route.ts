import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { dbErrorResponse, isUuid, jsonError, readJsonObject } from "@/app/lib/http";

/**
 * PATCH /api/admin/users/[id]   (ADMIN)
 * body: { isActive: boolean }
 * Deactivation fires trg_user_deactivate_revoke_sessions (migration 001), which signs the
 * user out everywhere at once; trg_user_status_guard (migration 004) refuses to deactivate
 * the last active admin; trg_user_status_audit records USER_STATUS_CHANGED.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireRole("ADMIN");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "User not found.");

  const body = await readJsonObject(request);
  if (typeof body?.isActive !== "boolean") return jsonError(400, "isActive must be true or false.");
  if (id === auth.user.userId && body.isActive === false) {
    return jsonError(409, "You cannot deactivate your own account.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('claimguard.actor_id', $1, true)", [auth.user.userId]);
    const { rows } = await client.query<{ is_active: boolean }>(
      `UPDATE app_user SET is_active = $2
       WHERE user_id = $1 AND is_active IS DISTINCT FROM $2
       RETURNING is_active`,
      [id, body.isActive]
    );
    await client.query("COMMIT");
    if (rows.length === 0) {
      const exists = await pool.query(`SELECT 1 FROM app_user WHERE user_id = $1`, [id]);
      return exists.rowCount
        ? jsonError(409, `The user is already ${body.isActive ? "active" : "inactive"}.`)
        : jsonError(404, "User not found.");
    }
    return NextResponse.json({ userId: id, isActive: rows[0].is_active });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    return dbErrorResponse(err, "PATCH /api/admin/users/[id]");
  } finally {
    client.release();
  }
}
