"use client";

import { useState } from "react";

export interface HolderOption {
  userId: string;
  fullName: string;
  email: string;
}

function addYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Issue a policy → POST /api/admin/policies. */
export default function IssuePolicyForm({ holders, suggestedNumber }: { holders: HolderOption[]; suggestedNumber: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [holderId, setHolderId] = useState(holders[0]?.userId ?? "");
  const [policyNumber, setPolicyNumber] = useState(suggestedNumber);
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState(addYear(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ holderId, policyNumber, effectiveDate, expiryDate }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not issue the policy.");
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
  if (holders.length === 0) {
    return <p className="panel p-5 text-sm text-slate-500">There are no active policyholders to issue a policy to.</p>;
  }

  return (
    <form onSubmit={submit} className="panel h-fit space-y-4 p-5">
      <p className="text-sm font-semibold text-[#172b4d]">Issue a policy</p>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Policyholder</span>
        <select value={holderId} onChange={(e) => setHolderId(e.target.value)} className={input}>
          {holders.map((h) => <option key={h.userId} value={h.userId}>{h.fullName} ({h.email})</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Policy number</span>
        <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} required maxLength={40} className={`${input} font-mono`} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Effective</span>
          <input type="date" required value={effectiveDate}
            onChange={(e) => { setEffectiveDate(e.target.value); if (e.target.value) setExpiryDate(addYear(e.target.value)); }}
            className={input} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Expiry</span>
          <input type="date" required value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={input} />
        </label>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5] disabled:opacity-50">
        {busy ? "Issuing…" : "Issue policy"}
      </button>
    </form>
  );
}
