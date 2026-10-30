import { redirect } from "next/navigation";
import pool from "@/app/db/pool";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import SimpleShell from "@/app/components/SimpleShell";

export const metadata = { title: "My claims | ClaimGuard" };

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  AWAITING_INFO: "Information needed",
  DECIDED: "Decided",
};

// Policyholders see only their own policies and claims (ownership enforced in SQL).
export default async function MyClaimsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "POLICYHOLDER") redirect(homePathFor(user.role));

  const { rows } = await pool.query<{
    claim_id: string;
    policy_number: string;
    incident_date: Date;
    claimed_amount: string;
    claim_status: string;
    decision_status: string | null;
    submitted_at: Date;
  }>(
    `SELECT c.claim_id, p.policy_number, c.incident_date, c.claimed_amount,
            c.claim_status, d.decision_status, c.submitted_at
     FROM claim c
     JOIN policy p ON p.policy_id = c.policy_id
     LEFT JOIN claim_decision d ON d.claim_id = c.claim_id
     WHERE c.claimant_id = $1
     ORDER BY c.submitted_at DESC`,
    [user.userId]
  );

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <SimpleShell
      user={user}
      title="My claims"
      subtitle="Claims you have submitted against your policies."
    >
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Claim</th>
              <th className="px-5 py-3">Policy</th>
              <th className="px-5 py-3">Incident date</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                  You have not submitted any claims yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.claim_id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 font-mono text-xs">
                    CL-{r.claim_id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="px-5 py-3">{r.policy_number}</td>
                  <td className="px-5 py-3">{fmtDate(r.incident_date)}</td>
                  <td className="px-5 py-3 text-right">
                    ₹{Number(r.claimed_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3">
                    {r.decision_status
                      ? r.decision_status === "APPROVED" ? "Approved" : "Rejected"
                      : STATUS_LABEL[r.claim_status] ?? r.claim_status}
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
