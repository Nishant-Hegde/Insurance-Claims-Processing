"use client";

import { useState } from "react";
import type { NotificationItem } from "@/app/lib/notifications";
import { fmtDateTime, shortClaimId } from "@/app/lib/format";

export default function NotificationList({
  items,
  showAll,
  claimBase,
}: {
  items: NotificationItem[];
  showAll: boolean;
  claimBase: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(url: string, init: RequestInit, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  }

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href="/notifications" className={!showAll ? "font-semibold text-[#172b4d]" : "text-[#315ee7] hover:underline"}>Inbox</a>
        <a href="/notifications?show=all" className={showAll ? "font-semibold text-[#172b4d]" : "text-[#315ee7] hover:underline"}>Including dismissed</a>
        {unread > 0 && (
          <button
            onClick={() => void act("/api/notifications/read-all", { method: "POST" }, "all")}
            disabled={busy !== null}
            className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Mark all {unread} as read
          </button>
        )}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {items.length === 0 ? (
        <p className="panel p-8 text-center text-sm text-slate-500">No notifications.</p>
      ) : (
        <ul className="panel divide-y divide-slate-100">
          {items.map((n) => (
            <li key={n.notificationId} className={`flex flex-wrap items-start gap-4 px-5 py-4 ${n.dismissedAt ? "opacity-60" : ""}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-[#315ee7]"}`} aria-label={n.readAt ? "Read" : "Unread"} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.readAt ? "text-slate-600" : "font-semibold text-[#172b4d]"}`}>{n.message}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {n.type.replaceAll("_", " ").toLowerCase()} · {fmtDateTime(n.createdAt)}
                  {n.claimId && (
                    <>
                      {" · "}
                      <a href={`${claimBase}/${n.claimId}`} className="text-[#315ee7] hover:underline">{shortClaimId(n.claimId)}</a>
                    </>
                  )}
                  {n.dismissedAt && " · dismissed"}
                </p>
              </div>
              {!n.dismissedAt && (
                <div className="flex gap-2">
                  {!n.readAt && (
                    <button
                      onClick={() => void act(`/api/notifications/${n.notificationId}`, { method: "PATCH", body: JSON.stringify({ action: "read" }) }, n.notificationId)}
                      disabled={busy !== null}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    onClick={() => void act(`/api/notifications/${n.notificationId}`, { method: "PATCH", body: JSON.stringify({ action: "dismiss" }) }, n.notificationId)}
                    disabled={busy !== null}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
