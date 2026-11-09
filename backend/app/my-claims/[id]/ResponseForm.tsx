"use client";

import { useState } from "react";

export default function ResponseForm({ claimId }: { claimId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your answer.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <textarea
        required
        minLength={10}
        maxLength={5000}
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your answer, and which documents you are providing"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5] disabled:opacity-50">
        {busy ? "Sending…" : "Send answer"}
      </button>
    </form>
  );
}
