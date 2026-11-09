import { redirect } from "next/navigation";
import pool from "@/app/db/pool";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { isUuid } from "@/app/lib/http";
import { fmtDateTime, shortClaimId } from "@/app/lib/format";
import SimpleShell from "@/app/components/SimpleShell";

export const metadata = { title: "Audit log | ClaimGuard" };

// Same vocabulary as ck_audit_action in the schema.
const ACTIONS = [
  "CLAIM_SUBMITTED", "SCREENING_COMPLETED", "SCREENING_FAILED", "REVIEW_RECORDED",
  "DECISION_RECORDED", "INFORMATION_RESPONSE_ADDED", "REFERENCE_CASE_ADDED",
  "REFERENCE_CASE_DEACTIVATED", "POLICY_ISSUED", "USER_CREATED", "USER_ROLE_CHANGED",
  "USER_STATUS_CHANGED", "NOTIFICATION_DISMISSED",
] as const;
const PAGE_SIZE = 25;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

// Admin only: the append-only audit trail written by database triggers.
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(homePathFor(user.role));

  const sp = await searchParams;
  const action = (ACTIONS as readonly string[]).includes(one(sp.action) ?? "") ? one(sp.action) : null;
  const actor = one(sp.actor);
  const actorFilter = actor === "SYSTEM" ? "SYSTEM" : isUuid(actor) ? actor : null;
  // Accept a full claim UUID or the short "CL-XXXXXXXX" form shown in the UI (last 8 hex digits).
  const claimInput = one(sp.claim)?.replace(/^CL-/i, "").toLowerCase() ?? null;
  const claimFull = isUuid(claimInput) ? claimInput : null;
  const claimPrefix = !claimFull && claimInput && /^[0-9a-f]{4,8}$/.test(claimInput) ? claimInput : null;
  const page = Math.max(1, Math.min(10_000, Number(one(sp.page)) || 1));

  const [{ rows }, { rows: actors }] = await Promise.all([
    pool.query<{
      audit_id: string;
      occurred_at: Date;
      actor_type: string;
      actor_name: string | null;
      action: string;
      claim_id: string | null;
      reference_title: string | null;
      target_name: string | null;
      details: Record<string, unknown>;
      total: string;
    }>(
      // count(*) OVER () returns the total match count on every row, so one query
      // gives both the page and the number of pages. Index ix_audit_claim / ix_audit_actor.
      `SELECT a.audit_id, a.occurred_at, a.actor_type, au.full_name AS actor_name, a.action,
              a.claim_id, rc.title AS reference_title, tu.full_name AS target_name, a.details,
              count(*) OVER () AS total
       FROM audit_log a
       LEFT JOIN app_user au ON au.user_id = a.actor_id
       LEFT JOIN app_user tu ON tu.user_id = a.target_user_id
       LEFT JOIN reference_fraud_case rc ON rc.case_id = a.reference_case_id
       WHERE ($1::text IS NULL OR a.action = $1::text)
         AND (NOT $2::boolean OR a.actor_type = 'SYSTEM')
         AND ($3::uuid IS NULL OR a.actor_id = $3::uuid)
         AND ($4::uuid IS NULL OR a.claim_id = $4::uuid)
         AND ($5::text IS NULL OR a.claim_id::text LIKE '%' || $5::text)
       ORDER BY a.occurred_at DESC, a.audit_id DESC
       LIMIT $6 OFFSET $7`,
      [action, actorFilter === "SYSTEM", actorFilter === "SYSTEM" ? null : actorFilter,
       claimFull, claimPrefix, PAGE_SIZE, (page - 1) * PAGE_SIZE]
    ),
    pool.query<{ user_id: string; full_name: string }>(
      `SELECT DISTINCT u.user_id, u.full_name
       FROM audit_log a JOIN app_user u ON u.user_id = a.actor_id
       ORDER BY u.full_name`
    ),
  ]);

  const total = Number(rows[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const q = new URLSearchParams();
    if (action) q.set("action", action);
    if (actor) q.set("actor", actor);
    if (one(sp.claim)) q.set("claim", one(sp.claim)!);
    q.set("page", String(p));
    return `/admin/audit?${q}`;
  };
  const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";

  return (
    <SimpleShell user={user} title="Audit log" subtitle="Every event is written by a database trigger in the same transaction as the change. Rows cannot be edited or deleted.">
      <form method="get" className="panel mb-5 grid gap-3 p-4 md:grid-cols-4">
        <select name="action" defaultValue={action ?? ""} className={input} aria-label="Action">
          <option value="">Any action</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a.replaceAll("_", " ").toLowerCase()}</option>)}
        </select>
        <select name="actor" defaultValue={actor ?? ""} className={input} aria-label="Actor">
          <option value="">Any actor</option>
          <option value="SYSTEM">System</option>
          {actors.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name}</option>)}
        </select>
        <input name="claim" defaultValue={one(sp.claim) ?? ""} placeholder="Claim (CL-00000003 or UUID)" className={input} />
        <div className="flex gap-2">
          <a href="/admin/audit" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Clear</a>
          <button className="rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5]">Filter</button>
        </div>
      </form>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">When</th>
              <th className="px-5 py-3">Action</th>
              <th className="px-5 py-3">Actor</th>
              <th className="px-5 py-3">Target</th>
              <th className="px-5 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">No audit events match these filters.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.audit_id} className="border-b border-slate-50 align-top last:border-0">
                <td className="whitespace-nowrap px-5 py-2.5 text-xs text-slate-600">{fmtDateTime(r.occurred_at)}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-xs font-semibold text-[#172b4d]">{r.action.replaceAll("_", " ").toLowerCase()}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-xs">{r.actor_type === "SYSTEM" ? <span className="text-slate-400">System</span> : r.actor_name}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-xs">
                  {r.claim_id ? (
                    <a href={`/adjuster/claims/${r.claim_id}`} className="font-mono text-[#315ee7] hover:underline">{shortClaimId(r.claim_id)}</a>
                  ) : r.reference_title ? (
                    <span title={r.reference_title}>Case: {r.reference_title.slice(0, 32)}{r.reference_title.length > 32 ? "…" : ""}</span>
                  ) : (
                    <span>User: {r.target_name}</span>
                  )}
                </td>
                <td className="max-w-[360px] px-5 py-2.5 font-mono text-[11px] leading-4 text-slate-500 break-all">
                  {JSON.stringify(r.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>{total} event{total === 1 ? "" : "s"} · page {Math.min(page, pages)} of {pages}</span>
        <div className="flex gap-2">
          {page > 1 && <a href={link(page - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50">Previous</a>}
          {page < pages && <a href={link(page + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50">Next</a>}
        </div>
      </div>
    </SimpleShell>
  );
}
