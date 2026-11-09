/** Notification queries (server-only). Every query is scoped to the signed-in user. */
import pool from "@/app/db/pool";

export async function unreadNotificationCount(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notification
     WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
    [userId]
  );
  return rows[0]?.n ?? 0;
}

export interface NotificationItem {
  notificationId: string;
  type: string;
  message: string;
  claimId: string | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

export async function listNotifications(userId: string, includeDismissed: boolean): Promise<NotificationItem[]> {
  // Partial index ix_notification_inbox (user_id, created_at DESC) WHERE dismissed_at IS NULL
  const { rows } = await pool.query<{
    notification_id: string;
    notification_type: string;
    message: string;
    claim_id: string | null;
    created_at: Date;
    read_at: Date | null;
    dismissed_at: Date | null;
  }>(
    `SELECT notification_id, notification_type, message, claim_id, created_at, read_at, dismissed_at
     FROM notification
     WHERE user_id = $1 AND ($2::boolean OR dismissed_at IS NULL)
     ORDER BY (read_at IS NULL) DESC, created_at DESC
     LIMIT 200`,
    [userId, includeDismissed]
  );
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return rows.map((r) => ({
    notificationId: r.notification_id,
    type: r.notification_type,
    message: r.message,
    claimId: r.claim_id,
    createdAt: new Date(r.created_at).toISOString(),
    readAt: iso(r.read_at),
    dismissedAt: iso(r.dismissed_at),
  }));
}
