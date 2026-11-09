import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import { dbErrorResponse } from "@/app/lib/http";

/** POST /api/notifications/read-all — marks every unread notification of the caller as read. */
export async function POST(): Promise<NextResponse> {
  const auth = await requireRole("POLICYHOLDER", "CLAIMS_ADJUSTER", "ADMIN");
  if ("response" in auth) return auth.response;
  try {
    const result = await pool.query(
      `UPDATE notification SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL`,
      [auth.user.userId]
    );
    return NextResponse.json({ updated: result.rowCount });
  } catch (err) {
    return dbErrorResponse(err, "POST /api/notifications/read-all");
  }
}
