import { NextResponse } from "next/server";
import { requireRole } from "@/app/lib/auth";
import { dbErrorResponse } from "@/app/lib/http";
import { listNotifications } from "@/app/lib/notifications";

/** GET /api/notifications?all=1 — the caller's own notifications (dismissed ones only with all=1). */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireRole("POLICYHOLDER", "CLAIMS_ADJUSTER", "ADMIN");
  if ("response" in auth) return auth.response;
  const includeDismissed = new URL(request.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json({ notifications: await listNotifications(auth.user.userId, includeDismissed) });
  } catch (err) {
    return dbErrorResponse(err, "GET /api/notifications");
  }
}
