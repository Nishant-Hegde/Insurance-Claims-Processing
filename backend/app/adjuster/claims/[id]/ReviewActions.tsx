"use client";

import { useState } from "react";

type Action = "APPROVED" | "REJECTED" | "INFO_REQUESTED";

const BUTTONS: { action: Action; label: string; style: string }[] = [
  { action: "APPROVED", label: "Approve", style: "bg-emerald-600 text-white hover:bg-emerald-700" },
  { action: "REJECTED", label: "Reject", style: "bg-red-600 text-white hover:bg-red-700" },
  { action: "INFO_REQUESTED", label: "Request information", style: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" },
];

/** Approve / Reject / Request info → POST /api/claims/[id]/review (CALL sp_decide_claim). */
export default function ReviewActions({ claimId }: { claimId: string }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: Action) {
    if (action !== "INFO_REQUESTED" &&
        !window.confirm(`${action === "APPROVED" ? "Approve" : "Reject"} this claim? A decision is final.`)) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claimId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, notes }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action failed.");
      setBusy(null);
    }
  }

  return (
    <div className="panel space-y-3 p-5">
      <p className="text-sm font-semibold text-[#172b4d]">Record a review</p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="Reasoning for a decision, or the question for the policyholder (min. 10 characters)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6"
      />
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="font-semibold">Not recorded. </span>{error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {BUTTONS.map((b) => (
          <button
            key={b.action}
            onClick={() => void decide(b.action)}
            disabled={busy !== null || notes.trim().length < 10}
            className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${b.style}`}
          >
            {busy === b.action ? "Saving…" : b.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-4 text-slate-400">
        The database checks every action: approval needs a completed screening, and a
        HIGH-risk claim needs an answered information request first.
      </p>
    </div>
  );
}
