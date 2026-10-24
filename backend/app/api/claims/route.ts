import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import type { ClaimRow, ClaimsResponse } from "@/app/types";

/**
 * Maps the DB screening risk_indicator to a short UI label.
 * The DB vocabulary is not specified in the SRS — these values follow the
 * risk-indicator naming convention used elsewhere in the codebase.
 */
function riskLabel(
  screeningStatus: string,
  riskIndicator: string | null
): string {
  if (screeningStatus === "PENDING") return "Pending";
  if (!riskIndicator) return "Pending";
  const lower = riskIndicator.toLowerCase();
  if (lower.includes("high")) return "High";
  if (lower.includes("medium") || lower.includes("med")) return "Medium";
  if (lower.includes("low")) return "Low";
  return "Pending";
}

/**
 * Maps DB claim_status to the UI label used in the dashboard.
 */
function statusLabel(claimStatus: string): string {
  switch (claimStatus) {
    case "SUBMITTED":
      return "Submitted";
    case "UNDER_REVIEW":
      return "Under review";
    case "AWAITING_INFO":
      return "Information needed";
    case "DECIDED":
      return "Approved";
    default:
      return claimStatus;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const result = await pool.query<{
      claim_id: string;
      full_name: string;
      claim_type: string | null;
      claimed_amount: string;
      submitted_at: Date;
      claim_status: string;
      screening_status: string;
      risk_indicator: string | null;
    }>(`
      SELECT
        c.claim_id,
        u.full_name,
        -- claim type is inferred from the description; the schema stores free text.
        -- We surface the first few words as a short label rather than the full description.
        left(c.description, 40)                 AS claim_type,
        c.claimed_amount,
        c.submitted_at,
        c.claim_status,
        c.screening_status,
        sa.risk_indicator
      FROM claim c
      JOIN app_user u ON u.user_id = c.claimant_id
      LEFT JOIN LATERAL (
        SELECT risk_indicator
        FROM   screening_assessment
        WHERE  claim_id = c.claim_id
          AND  status   = 'COMPLETED'
        ORDER  BY attempt_no DESC
        LIMIT  1
      ) sa ON true
      ORDER BY c.submitted_at DESC
      LIMIT 50
    `);

    const claims: ClaimRow[] = result.rows.map((row) => {
      const amount = parseFloat(row.claimed_amount);
      return {
        id: `CL-${row.claim_id.slice(0, 8).toUpperCase()}`,
        claimant: row.full_name,
        type: row.claim_type ?? "Insurance claim",
        amount: `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
        date: new Date(row.submitted_at).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        status: statusLabel(row.claim_status),
        risk: riskLabel(row.screening_status, row.risk_indicator),
      };
    });

    return NextResponse.json({ claims } satisfies ClaimsResponse);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown database error";
    console.error("[/api/claims]", message);
    return NextResponse.json(
      { error: "Failed to load claims." },
      { status: 503 }
    );
  }
}
