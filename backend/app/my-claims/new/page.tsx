import { redirect } from "next/navigation";
import pool from "@/app/db/pool";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import SimpleShell from "@/app/components/SimpleShell";
import NewClaimForm, { type PolicyOption } from "../NewClaimForm";

export const metadata = { title: "Submit a claim | ClaimGuard" };

export default async function NewClaimPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "POLICYHOLDER") redirect(homePathFor(user.role));

  // Only the caller's own active policies (POST /api/claims re-checks this).
  const { rows: policies } = await pool.query<PolicyOption>(
    `SELECT policy_id AS "policyId", policy_number AS "policyNumber",
            to_char(effective_date, 'YYYY-MM-DD') AS "effectiveDate",
            to_char(expiry_date, 'YYYY-MM-DD') AS "expiryDate"
     FROM policy
     WHERE holder_id = $1 AND is_active
     ORDER BY policy_number`,
    [user.userId]
  );

  return (
    <SimpleShell
      user={user}
      title="Submit a claim"
      subtitle="Tell us what happened. Your claim is checked automatically and then reviewed by an adjuster."
      backHref="/my-claims"
      backLabel="Back to my claims"
    >
      <div className="max-w-3xl">
        <NewClaimForm policies={policies} />
      </div>
    </SimpleShell>
  );
}
