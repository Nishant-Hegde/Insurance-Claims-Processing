import { redirect } from "next/navigation";
import pool from "@/app/db/pool";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { fmtDate, money } from "@/app/lib/format";
import SimpleShell from "@/app/components/SimpleShell";
import IssuePolicyForm, { type HolderOption } from "./IssuePolicyForm";

export const metadata = { title: "Policies | ClaimGuard" };

// Admin only: issue policies and see each policy's claim exposure.
export default async function PoliciesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(homePathFor(user.role));

  const [policies, holders, next] = await Promise.all([
    pool.query<{
      policy_id: string;
      policy_number: string;
      full_name: string;
      effective_date: Date;
      expiry_date: Date;
      is_active: boolean;
      claims: number;
      exposure: string;
      in_force: boolean;
    }>(
      `SELECT p.policy_id, p.policy_number, u.full_name, p.effective_date, p.expiry_date, p.is_active,
              count(c.claim_id)::int AS claims,
              coalesce(sum(c.claimed_amount), 0) AS exposure,
              (p.is_active AND CURRENT_DATE BETWEEN p.effective_date AND p.expiry_date) AS in_force
       FROM policy p
       JOIN app_user u ON u.user_id = p.holder_id
       LEFT JOIN claim c ON c.policy_id = p.policy_id
       GROUP BY p.policy_id, u.full_name
       ORDER BY p.created_at DESC`
    ),
    pool.query<HolderOption>(
      `SELECT u.user_id AS "userId", u.full_name AS "fullName", u.email
       FROM app_user u JOIN app_role r USING (role_id)
       WHERE r.role_name = 'POLICYHOLDER' AND u.is_active
       ORDER BY u.full_name`
    ),
    // Suggest the next number in this year's series; the UNIQUE constraint still decides.
    pool.query<{ suggestion: string }>(
      `SELECT 'POL-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
              lpad((coalesce(max(substring(policy_number FROM '^POL-' || to_char(CURRENT_DATE, 'YYYY') || '-(\\d+)$')::int), 0) + 1)::text, 4, '0')
              AS suggestion
       FROM policy`
    ),
  ]);

  return (
    <SimpleShell user={user} title="Policies" subtitle="Issue coverage to policyholders. Claims can only be filed against an active policy, for dates inside its period.">
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <IssuePolicyForm holders={holders.rows} suggestedNumber={next.rows[0]?.suggestion ?? ""} />

        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Policy</th>
                <th className="px-5 py-3">Holder</th>
                <th className="px-5 py-3">Coverage</th>
                <th className="px-5 py-3 text-right">Claims</th>
                <th className="px-5 py-3 text-right">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {policies.rows.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No policies yet.</td></tr>
              ) : policies.rows.map((p) => (
                <tr key={p.policy_id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs font-semibold">{p.policy_number}</span>
                    <span className={`status-pill ml-2 ${p.in_force ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {!p.is_active ? "inactive" : p.in_force ? "in force" : "outside period"}
                    </span>
                  </td>
                  <td className="px-5 py-3">{p.full_name}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{fmtDate(p.effective_date)} – {fmtDate(p.expiry_date)}</td>
                  <td className="px-5 py-3 text-right">{p.claims}</td>
                  <td className="px-5 py-3 text-right">{money(p.exposure)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SimpleShell>
  );
}
