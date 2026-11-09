import { redirect } from "next/navigation";
import pool from "@/app/db/pool";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { STATUS_LABEL, fmtDate, fmtDateTime, shortClaimId } from "@/app/lib/format";
import SimpleShell from "@/app/components/SimpleShell";

export const metadata = { title: "Reports | ClaimGuard" };

/** Horizontal bar row: label, bar scaled to max, value. Plain CSS, no chart library. */
function Bar({ label, value, max, sub, color = "#315ee7" }: { label: string; value: number; max: number; sub?: string; color?: string }) {
  return (
    <div className="text-xs">
      <div className="flex justify-between gap-3">
        <span className="truncate text-slate-700">{label}</span>
        <span className="font-mono font-semibold text-[#172b4d]">{value}{sub && <span className="font-normal text-slate-400"> {sub}</span>}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
    </div>
  );
}

function Card({ title, view, children }: { title: string; view: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#172b4d]">{title}</h2>
        <code className="text-[10px] text-slate-400">{view}</code>
      </div>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-sm text-slate-500">{text}</p>;
const RISK_COLOR: Record<string, string> = { HIGH: "#d64545", MEDIUM: "#e6a23c", LOW: "#2f9e6e" };

// Admin reports: each card reads one reporting view from the schema (FR-12 / FR-21).
export default async function AdminReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(homePathFor(user.role));

  const [status, risk, refs, workload, stale] = await Promise.all([
    pool.query<{ claim_status: string; screening_status: string; review_required: boolean; claim_count: string }>(
      `SELECT claim_status, screening_status, review_required, claim_count
       FROM v_claim_status_summary ORDER BY claim_count DESC`
    ),
    pool.query<{ assessment_day: Date; risk_indicator: string; assessment_count: string }>(
      `SELECT assessment_day, risk_indicator, assessment_count
       FROM v_risk_distribution_over_time
       WHERE assessment_day >= CURRENT_DATE - 90
       ORDER BY assessment_day DESC, risk_indicator`
    ),
    pool.query<{ title: string; match_count: string; average_similarity: number }>(
      `SELECT title, match_count, average_similarity
       FROM v_reference_match_frequency ORDER BY match_count DESC, average_similarity DESC LIMIT 10`
    ),
    pool.query<{ full_name: string; review_count: string; approvals: string; rejections: string; information_requests: string }>(
      `SELECT u.full_name, w.review_count, w.approvals, w.rejections, w.information_requests
       FROM v_adjuster_workload w JOIN app_user u ON u.user_id = w.reviewer_id
       ORDER BY w.review_count DESC`
    ),
    pool.query<{ claim_id: string; submitted_at: Date; last_attempt_at: Date | null; last_attempt_no: number }>(
      `SELECT claim_id, submitted_at, last_attempt_at, last_attempt_no
       FROM v_stale_pending_screening ORDER BY submitted_at`
    ),
  ]);

  // Totals per claim status (the view is grouped by status x screening x flag).
  const byStatus = new Map<string, number>();
  let flaggedOpen = 0;
  let total = 0;
  for (const r of status.rows) {
    const n = Number(r.claim_count);
    total += n;
    byStatus.set(r.claim_status, (byStatus.get(r.claim_status) ?? 0) + n);
    if (r.review_required && r.claim_status !== "DECIDED") flaggedOpen += n;
  }
  const maxStatus = Math.max(0, ...byStatus.values());

  // Risk per day → one row per day with HIGH/MEDIUM/LOW counts.
  const days = new Map<string, Record<string, number>>();
  for (const r of risk.rows) {
    const key = fmtDate(r.assessment_day);
    const row = days.get(key) ?? {};
    row[r.risk_indicator] = Number(r.assessment_count);
    days.set(key, row);
  }
  const maxDay = Math.max(0, ...[...days.values()].map((d) => Object.values(d).reduce((a, b) => a + b, 0)));
  const maxRef = Math.max(0, ...refs.rows.map((r) => Number(r.match_count)));
  const maxWork = Math.max(0, ...workload.rows.map((r) => Number(r.review_count)));

  return (
    <SimpleShell user={user} title="Reports" subtitle="Live figures from the database reporting views.">
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Claims", total],
          ["Open claims", total - (byStatus.get("DECIDED") ?? 0)],
          ["Open and flagged HIGH", flaggedOpen],
          ["Stale pending screenings", stale.rows.length],
        ].map(([label, value]) => (
          <div key={label as string} className="panel p-5">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-bold text-[#172b4d]">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Claims by status" view="v_claim_status_summary">
          {byStatus.size === 0 ? <Empty text="No claims yet." /> : (
            <div className="space-y-3">
              {[...byStatus.entries()].map(([s, n]) => (
                <Bar key={s} label={STATUS_LABEL[s] ?? s} value={n} max={maxStatus} />
              ))}
            </div>
          )}
          <table className="mt-5 w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr><th className="py-1">Status</th><th>Screening</th><th>Flagged</th><th className="text-right">Claims</th></tr>
            </thead>
            <tbody className="text-slate-600">
              {status.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-50">
                  <td className="py-1">{STATUS_LABEL[r.claim_status] ?? r.claim_status}</td>
                  <td>{r.screening_status.toLowerCase()}</td>
                  <td>{r.review_required ? "yes" : "no"}</td>
                  <td className="text-right">{r.claim_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Risk results per day (last 90 days)" view="v_risk_distribution_over_time">
          {days.size === 0 ? <Empty text="No completed screenings in the last 90 days." /> : (
            <div className="space-y-3">
              {[...days.entries()].map(([day, counts]) => {
                const sum = Object.values(counts).reduce((a, b) => a + b, 0);
                return (
                  <div key={day} className="text-xs">
                    <div className="flex justify-between text-slate-700">
                      <span>{day}</span>
                      <span className="text-slate-500">
                        {["HIGH", "MEDIUM", "LOW"].filter((k) => counts[k]).map((k) => `${counts[k]} ${k.toLowerCase()}`).join(" · ")}
                      </span>
                    </div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-100" style={{ width: `${maxDay ? (sum / maxDay) * 100 : 0}%` }}>
                      {["HIGH", "MEDIUM", "LOW"].map((k) => counts[k] ? (
                        <div key={k} style={{ width: `${(counts[k] / sum) * 100}%`, background: RISK_COLOR[k] }} />
                      ) : null)}
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-slate-400">Failed screenings are not counted as a risk level.</p>
            </div>
          )}
        </Card>

        <Card title="Most matched reference cases" view="v_reference_match_frequency">
          {refs.rows.length === 0 ? <Empty text="No screening matches yet." /> : (
            <div className="space-y-3">
              {refs.rows.map((r, i) => (
                <Bar key={i} label={r.title} value={Number(r.match_count)} max={maxRef}
                  sub={`avg ${Number(r.average_similarity).toFixed(2)}`} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Adjuster workload" view="v_adjuster_workload">
          {workload.rows.length === 0 ? <Empty text="No reviews recorded yet." /> : (
            <div className="space-y-3">
              {workload.rows.map((r) => (
                <Bar key={r.full_name} label={r.full_name} value={Number(r.review_count)} max={maxWork}
                  sub={`${r.approvals} approved · ${r.rejections} rejected · ${r.information_requests} info`} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Screenings pending for over 15 minutes" view="v_stale_pending_screening">
          {stale.rows.length === 0 ? <Empty text="Nothing is stuck. Every claim has a screening result." /> : (
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400">
                <tr><th className="py-1">Claim</th><th>Submitted</th><th>Last attempt</th></tr>
              </thead>
              <tbody className="text-slate-600">
                {stale.rows.map((r) => (
                  <tr key={r.claim_id} className="border-t border-slate-50">
                    <td className="py-1">
                      <a href={`/adjuster/claims/${r.claim_id}`} className="font-mono text-[#315ee7] hover:underline">{shortClaimId(r.claim_id)}</a>
                    </td>
                    <td>{fmtDateTime(r.submitted_at)}</td>
                    <td>{r.last_attempt_at ? `#${r.last_attempt_no}, ${fmtDateTime(r.last_attempt_at)}` : "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </SimpleShell>
  );
}
