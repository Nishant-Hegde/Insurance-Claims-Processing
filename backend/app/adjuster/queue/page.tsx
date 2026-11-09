import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { isIsoDate } from "@/app/lib/http";
import {
  loadQueue,
  QUEUE_RISKS,
  QUEUE_SORTS,
  QUEUE_STATUSES,
  type QueueFilters,
  type QueueSort,
} from "@/app/lib/queue";
import { STATUS_LABEL, fmtDate, money, shortClaimId } from "@/app/lib/format";
import SimpleShell from "@/app/components/SimpleShell";
import { RiskPill } from "@/app/components/Pills";

export const metadata = { title: "Review queue | ClaimGuard" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Renders ts_headline output, turning <<word>> into <mark> without using raw HTML. */
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(<<[^>]*>>)/g).map((part, i) =>
        part.startsWith("<<") ? (
          <mark key={i} className="rounded bg-yellow-100 px-0.5 text-[#172b4d]">{part.slice(2, -2)}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// Claims adjusters (and admins, read-only): open claims needing attention.
export default async function QueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "POLICYHOLDER") redirect(homePathFor(user.role));

  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 200) ?? null;
  const sortParam = one(sp.sort);
  const filters: QueueFilters = {
    status: pick(one(sp.status), QUEUE_STATUSES),
    risk: pick(one(sp.risk), QUEUE_RISKS),
    from: isIsoDate(one(sp.from)) ? one(sp.from) : null,
    to: isIsoDate(one(sp.to)) ? one(sp.to) : null,
    flaggedOnly: one(sp.flagged) === "1",
    q,
    sort: sortParam && sortParam in QUEUE_SORTS ? (sortParam as QueueSort) : q ? "relevance" : "oldest",
  };

  let rows: Awaited<ReturnType<typeof loadQueue>> = [];
  let error: string | null = null;
  try {
    rows = await loadQueue(filters);
  } catch (err) {
    console.error("[/adjuster/queue]", err instanceof Error ? err.message : err);
    error = "The queue could not be loaded. Try again.";
  }
  const flagged = rows.filter((r) => r.reviewRequired).length;
  const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";

  return (
    <SimpleShell
      user={user}
      title="Review queue"
      subtitle={`${rows.length} open claim${rows.length === 1 ? "" : "s"}${flagged ? ` · ${flagged} flagged for mandatory review` : ""}`}
    >
      <form method="get" className="panel mb-5 grid gap-3 p-4 md:grid-cols-6">
        <input name="q" defaultValue={q ?? ""} placeholder="Search descriptions (e.g. garage invoice)" className={`${input} md:col-span-2`} />
        <select name="status" defaultValue={filters.status ?? ""} className={input} aria-label="Status">
          <option value="">Any status</option>
          {QUEUE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select name="risk" defaultValue={filters.risk ?? ""} className={input} aria-label="Risk">
          <option value="">Any risk</option>
          {QUEUE_RISKS.map((r) => <option key={r} value={r}>{r === "FAILED" ? "Screening failed" : r === "PENDING" ? "Not screened" : r}</option>)}
        </select>
        <input type="date" name="from" defaultValue={filters.from ?? ""} className={input} aria-label="Submitted from" />
        <input type="date" name="to" defaultValue={filters.to ?? ""} className={input} aria-label="Submitted to" />
        <select name="sort" defaultValue={filters.sort} className={input} aria-label="Sort">
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="risk">Highest risk first</option>
          <option value="amount">Largest amount first</option>
          <option value="relevance">Best text match (when searching)</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="flagged" value="1" defaultChecked={filters.flaggedOnly} /> Flagged only
        </label>
        <div className="flex gap-2 md:col-span-4 md:justify-end">
          <a href="/adjuster/queue" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Clear</a>
          <button className="rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5]">Apply</button>
        </div>
      </form>

      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Claim</th>
              <th className="px-5 py-3">Description</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Risk</th>
              <th className="px-5 py-3 text-right">Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                  {error ? "—" : "No open claims match these filters."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.claimId} className="border-b border-slate-50 align-top last:border-0">
                  <td className="whitespace-nowrap px-5 py-3">
                    <a href={`/adjuster/claims/${r.claimId}`} className="font-mono text-xs font-bold text-[#315ee7] hover:underline">
                      {shortClaimId(r.claimId)}
                    </a>
                    <p className="text-xs text-slate-600">{r.claimant}</p>
                    <p className="text-[11px] text-slate-400">{r.policyNumber} · {fmtDate(r.submittedAt)}</p>
                  </td>
                  <td className="max-w-[380px] px-5 py-3 text-xs leading-5 text-slate-600">
                    {r.headline ? <Highlighted text={r.headline} /> : `${r.excerpt}…`}
                    {r.rank !== null && <span className="ml-1 text-[10px] text-slate-400">(rank {r.rank.toFixed(3)})</span>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">{money(r.amount)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-xs">{STATUS_LABEL[r.claimStatus] ?? r.claimStatus}</td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <RiskPill screeningStatus={r.screeningStatus} risk={r.riskIndicator} />
                    {r.reviewRequired && <span className="mt-1 block text-[10px] font-semibold text-red-700">Review required</span>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-slate-600">
                    {r.ageHours >= 48 ? `${Math.floor(r.ageHours / 24)} d` : `${r.ageHours} h`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </SimpleShell>
  );
}
