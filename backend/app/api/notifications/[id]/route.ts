import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { dbErrorResponse, isUuid, jsonError, readJsonObject } from "@/app/lib/http";

/**
 * PATCH /api/notifications/[id]   (any signed-in role, own notifications only)
 * body: { action: "read" | "dismiss" }
 * Only read_at / dismissed_at can change (trg_notification_update_guard); dismissing also
 * marks it read, because the CHECK constraint requires read before dismissed.
 * Dismissal is audited by trg_notification_audit.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireRole("POLICYHOLDER", "CLAIMS_ADJUSTER", "ADMIN");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Notification not found.");

  const body = await readJsonObject(request);
  const action = body?.action;
  if (action !== "read" && action !== "dismiss") {
    return jsonError(400, 'action must be "read" or "dismiss".');
  }

  try {
    const { rows } = await pool.query<{ read_at: Date | null; dismissed_at: Date | null }>(
      action === "read"
        ? `UPDATE notification SET read_at = coalesce(read_at, now())
           WHERE notification_id = $1 AND user_id = $2
           RETURNING read_at, dismissed_at`
        : `UPDATE notification SET read_at = coalesce(read_at, now()),
                                   dismissed_at = coalesce(dismissed_at, now())
           WHERE notification_id = $1 AND user_id = $2
           RETURNING read_at, dismissed_at`,
      [id, auth.user.userId]
    );
    // Someone else's notification looks exactly like a missing one.
    if (rows.length === 0) return jsonError(404, "Notification not found.");
    return NextResponse.json({ notificationId: id, readAt: rows[0].read_at, dismissedAt: rows[0].dismissed_at });
  } catch (err) {
    return dbErrorResponse(err, "PATCH /api/notifications/[id]");
  }
}
