"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReferenceCaseSummary } from "@/app/lib/referenceCases";

type Status = "active" | "inactive" | "all";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function ReferenceCasesTable() {
  const [status, setStatus] = useState<Status>("active");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [cases, setCases] = useState<ReferenceCaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ status });
    if (submittedQuery.trim()) params.set("q", submittedQuery.trim());
    try {
      const res = await fetch(`/api/reference-cases?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCases(body.cases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reference cases.");
      setCases([]);
    }
  }, [status, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deactivate(c: ReferenceCaseSummary) {
    if (!window.confirm(`Deactivate "${c.title}"?\n\nIt will no longer be used for screening. This cannot be undone.`)) return;
    setBusyId(c.caseId);
    try {
      const res = await fetch(`/api/reference-cases/${c.caseId}/deactivate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate the case.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQuery(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Keyword search (e.g. invoice workshop)"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Search
          </button>
        </form>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <a
          href="/admin/reference-cases/new"
          className="rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5]"
        >
          New reference case
        </a>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Case</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Model</th>
              <th className="px-5 py-3 text-right">Matches</th>
              <th className="px-5 py-3">Created</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cases === null ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading…</td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">No reference cases found.</td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.caseId} className="border-b border-slate-50 align-top last:border-0">
                  <td className="max-w-[420px] px-5 py-3">
                    <a href={`/admin/reference-cases/${c.caseId}`} className="font-semibold text-[#172b4d] hover:underline">
                      {c.title}
                    </a>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.excerpt}</p>
                    {c.supersedesCaseId && (
                      <p className="mt-1 text-[11px] text-slate-400">Revised version of an earlier case</p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {c.isActive ? (
                      <span className="status-pill bg-emerald-50 text-emerald-700">Active</span>
                    ) : (
                      <span className="status-pill bg-slate-100 text-slate-500">
                        {c.supersededByCaseId ? "Superseded" : "Inactive"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {c.modelName.replace("sentence-transformers/", "")}
                    <span className="block text-slate-400">{c.modelVersion}</span>
                  </td>
                  <td className="px-5 py-3 text-right">{c.matchCount}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {fmtDate(c.createdAt)}
                    <span className="block text-slate-400">{c.createdBy}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {c.isActive && (
                      <div className="flex justify-end gap-2">
                        <a
                          href={`/admin/reference-cases/${c.caseId}`}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </a>
                        <button
                          onClick={() => void deactivate(c)}
                          disabled={busyId === c.caseId}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {busyId === c.caseId ? "Deactivating…" : "Deactivate"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
