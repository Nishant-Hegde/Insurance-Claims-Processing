/**
 * Horizontal bar for a cosine similarity in [0, 1] (values below 0 are drawn as 0).
 * One neutral colour on purpose: risk thresholds live in the versioned risk_rule table,
 * so the UI must not invent its own cut-offs.
 */
export default function SimilarityBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100" aria-hidden>
      <div className="h-1.5 rounded-full bg-[#315ee7]" style={{ width: `${pct}%` }} />
    </div>
  );
}
