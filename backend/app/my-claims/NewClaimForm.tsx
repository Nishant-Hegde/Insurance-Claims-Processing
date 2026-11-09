"use client";

import { useState } from "react";
import { shortClaimId } from "@/app/lib/format";

export interface PolicyOption {
  policyId: string;
  policyNumber: string;
  effectiveDate: string;
  expiryDate: string;
}

interface Submitted {
  claimId: string;
  screening: { status: "COMPLETED" | "FAILED" | "PENDING"; message: string };
}

const SCREENING_LABEL: Record<Submitted["screening"]["status"], string> = {
  COMPLETED: "Automatic check completed",
  FAILED: "Automatic check could not run yet",
  PENDING: "Automatic check pending",
};

/** Policyholder claim submission → POST /api/claims. Shows screening status, never fraud evidence. */
export default function NewClaimForm({ policies }: { policies: PolicyOption[] }) {
  const [policyId, setPolicyId] = useState(policies[0]?.policyId ?? "");
  const [incidentDate, setIncidentDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Submitted | null>(null);

  if (policies.length === 0) {
    return <p className="panel p-6 text-sm text-slate-500">You have no active policy to claim against.</p>;
  }

  if (done) {
    return (
      <div className="panel space-y-3 p-6">
        <p className="text-lg font-semibold text-[#172b4d]">Claim received</p>
        <p className="text-sm text-slate-600">
          Reference <span className="font-mono">{shortClaimId(done.claimId)}</span>
        </p>
        <p className="text-sm">
          <span className={`status-pill ${done.screening.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {SCREENING_LABEL[done.screening.status]}
          </span>
        </p>
        <p className="text-sm text-slate-600">{done.screening.message}</p>
        <a href={`/my-claims/${done.claimId}`} className="inline-block rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5]">
          View claim
        </a>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId, incidentDate, claimedAmount: Number(amount), description }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDone(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the claim.");
    } finally {
      setBusy(false);
    }
  }

  const selected = policies.find((p) => p.policyId === policyId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={submit} className="panel grid gap-4 p-6 md:grid-cols-3">
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Policy</span>
        <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
          {policies.map((p) => <option key={p.policyId} value={p.policyId}>{p.policyNumber}</option>)}
        </select>
        {selected && <span className="mt-1 block text-[11px] text-slate-400">Covered {selected.effectiveDate} to {selected.expiryDate}</span>}
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Incident date</span>
        <input type="date" required value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)}
          min={selected?.effectiveDate}
          max={selected && selected.expiryDate < today ? selected.expiryDate : today}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Amount claimed (₹)</span>
        <input type="number" required min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </label>
      <label className="block md:col-span-3">
        <span className="text-xs font-semibold text-slate-600">What happened? (at least 20 characters)</span>
        <textarea required minLength={20} maxLength={5000} rows={6} value={description} onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" />
      </label>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-3">{error}</p>}
      <div className="md:col-span-3">
        <button disabled={busy} className="rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5] disabled:opacity-50">
          {busy ? "Submitting and checking…" : "Submit claim"}
        </button>
      </div>
    </form>
  );
}
