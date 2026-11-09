"use client";

import { useState } from "react";

export default function RescreenButton({ claimId }: { claimId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rescreen() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/rescreen`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-screen failed.");
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        onClick={() => void rescreen()}
        disabled={busy}
        className="rounded-lg bg-[#315ee7] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2446a5] disabled:opacity-50"
      >
        {busy ? "Screening…" : "Re-run screening"}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
