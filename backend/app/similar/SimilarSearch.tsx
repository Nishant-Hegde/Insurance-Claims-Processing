"use client";

import { useState } from "react";
import type { SimilarResult } from "@/app/lib/similarity";
import SimilarityBar from "@/app/components/SimilarityBar";

const EXAMPLE =
  "Somebody's car stopped suddenly in front of me for no reason and I crashed into it. The other driver and the tow truck guy seemed to know each other.";

export default function SimilarSearch() {
  const [text, setText] = useState("");
  const [k, setK] = useState(5);
  const [result, setResult] = useState<SimilarResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const started = performance.now();
    try {
      const params = new URLSearchParams({ text, k: String(k) });
      const res = await fetch(`/api/similar?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
      setMs(Math.round(performance.now() - started));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={search} className="panel space-y-3 p-5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="e.g. The garage bill listed parts that were never broken…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={busy || text.trim().length < 3}
            className="rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5] disabled:opacity-50"
          >
            {busy ? "Searching…" : "Find similar cases"}
          </button>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Top
            <select value={k} onChange={(e) => setK(Number(e.target.value))} className="rounded-md border border-slate-200 px-2 py-1">
              {[3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setText(EXAMPLE)} className="text-xs text-[#315ee7] hover:underline">
            Use an example
          </button>
        </div>
      </form>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="panel p-5">
          <p className="mb-4 text-xs text-slate-500">
            {result.results.length} nearest active cases · model {result.model.name} ({result.model.version}),{" "}
            {result.model.dimension} dims · cosine similarity{ms !== null ? ` · ${ms} ms` : ""}
          </p>
          <ol className="space-y-4">
            {result.results.map((r, i) => (
              <li key={r.caseId} className="border-b border-slate-50 pb-4 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-sm font-semibold text-[#172b4d]">
                    {i + 1}. {r.title}
                  </p>
                  <span className="font-mono text-sm font-semibold text-[#172b4d]">{r.similarity.toFixed(3)}</span>
                </div>
                <SimilarityBar value={r.similarity} />
                <p className="mt-2 text-xs leading-5 text-slate-500">{r.excerpt}…</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[11px] text-slate-400">
            Similarity is advisory evidence for an adjuster, not a probability of fraud.
          </p>
        </div>
      )}
    </div>
  );
}
