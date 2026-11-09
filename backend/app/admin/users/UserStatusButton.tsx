"use client";

import { useState } from "react";

export default function UserStatusButton({ userId, name, isActive }: { userId: string; name: string; isActive: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (isActive && !window.confirm(`Deactivate ${name}? They will be signed out everywhere immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the user.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={() => void toggle()}
        disabled={busy}
        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
          isActive ? "border-red-200 text-red-700 hover:bg-red-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
        }`}
      >
        {busy ? "Saving…" : isActive ? "Deactivate" : "Activate"}
      </button>
      {error && <p className="mt-1 max-w-[220px] text-left text-xs text-red-700">{error}</p>}
    </div>
  );
}
