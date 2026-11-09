import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import type { ClaimRow, ClaimsResponse } from "@/app/types";
import { requireRole } from "@/app/lib/auth";
import { cleanText, dbErrorResponse, isIsoDate, isUuid, jsonError, readJsonObject } from "@/app/lib/http";
import { screenClaim } from "@/app/lib/screening";
import { shortClaimId } from "@/app/lib/format";

const MAX_AMOUNT = 9_999_999_999.99; // numeric(12,2)

/**
 * POST /api/claims — a policyholder submits a claim.
 *   body: { policyId, incidentDate: "YYYY-MM-DD", claimedAmount, description }
 *
 * 1. Validate input and check the policy is the caller's own active policy.
 * 2. INSERT the claim in its own transaction and COMMIT: the claim is accepted no matter
 *    what happens to screening (claim triggers check the date range and write the audit row).
 * 3. Screen it (embedding service + CALL sp_screen_claim). If the service is down the
 *    attempt is stored as FAILED, never LOW, and staff can re-screen later.
 *
 * The response tells the policyholder only that screening ran, not its risk result:
 * fraud evidence is for adjusters (see GET /api/claims/[id]).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireRole("POLICYHOLDER");
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, "Send a JSON object.");

  const policyId = body.policyId;
  const incidentDate = body.incidentDate;
  const amount = typeof body.claimedAmount === "string" ? Number(body.claimedAmount) : body.claimedAmount;
  const description = cleanText(body.description, 20, 5000);

  if (!isUuid(policyId)) return jsonError(400, "Choose one of your policies.");
  if (!isIsoDate(incidentDate)) {
    return jsonError(400, "Incident date must be a valid date (YYYY-MM-DD).");
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT ||
      Math.round(amount * 100) !== amount * 100) {
    return jsonError(400, "Claimed amount must be a positive number with at most 2 decimals.");
  }
  if (!description) {
    return jsonError(400, "Describe what happened in 20 to 5000 characters.");
  }

  let claimId: string;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('claimguard.actor_id', $1, true)", [user.userId]);
    const owned = await client.query(
      `SELECT 1 FROM policy WHERE policy_id = $1 AND holder_id = $2 AND is_active`,
      [policyId, user.userId]
    );
    if (owned.rowCount === 0) {
      await client.query("ROLLBACK");
      return jsonError(403, "You can only claim against your own active policies.");
    }
    const inserted = await client.query<{ claim_id: string }>(
      `INSERT INTO claim (policy_id, claimant_id, incident_date, claimed_amount, description)
       VALUES ($1, $2, $3::date, $4::numeric, $5)
       RETURNING claim_id`,
      [policyId, user.userId, incidentDate, amount.toFixed(2), description]
    );
    await client.query("COMMIT");
    claimId = inserted.rows[0].claim_id;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    return dbErrorResponse(err, "POST /api/claims insert");
  } finally {
    client.release();
  }

  let screeningStatus: "COMPLETED" | "FAILED" | "PENDING" = "PENDING";
  try {
    screeningStatus = (await screenClaim(claimId, description, null)).status;
  } catch (err) {
    // The claim is saved; it stays PENDING and shows up in v_stale_pending_screening.
    console.error("[POST /api/claims screening]", err instanceof Error ? err.message : err);
  }

  return NextResponse.json(
    {
      claimId,
      claimStatus: "SUBMITTED",
      screening: {
        status: screeningStatus,
        message:
          screeningStatus === "COMPLETED"
            ? "Your claim was received and checked automatically. An adjuster will review it."
            : "Your claim was received. The automatic check could not run yet; an adjuster will retry it.",
      },
    },
    { status: 201 }
  );
}

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
  // BR-13: a failed screening is shown as failed, never as a risk level.
  if (screeningStatus === "FAILED") return "Screening failed";
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
function statusLabel(claimStatus: string, decision: string | null): string {
  if (decision) return decision === "APPROVED" ? "Approved" : "Rejected";
  switch (claimStatus) {
    case "SUBMITTED":
      return "Submitted";
    case "UNDER_REVIEW":
      return "Under review";
    case "AWAITING_INFO":
      return "Information needed";
    case "DECIDED":
      return "Decided";
    default:
      return claimStatus;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireRole("POLICYHOLDER", "CLAIMS_ADJUSTER", "ADMIN");
    if ("response" in auth) return auth.response;
    // Policyholders only ever receive their own claims; staff see all.
    const ownerFilter =
      auth.user.role === "POLICYHOLDER" ? auth.user.userId : null;

    const result = await pool.query<{
      claim_id: string;
      full_name: string;
      claim_type: string | null;
      claimed_amount: string;
      submitted_at: Date;
      claim_status: string;
      screening_status: string;
      risk_indicator: string | null;
      decision_status: string | null;
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
        sa.risk_indicator,
        d.decision_status
      FROM claim c
      LEFT JOIN claim_decision d ON d.claim_id = c.claim_id
      JOIN app_user u ON u.user_id = c.claimant_id
      LEFT JOIN LATERAL (
        SELECT risk_indicator
        FROM   screening_assessment
        WHERE  claim_id = c.claim_id
          AND  status   = 'COMPLETED'
        ORDER  BY attempt_no DESC
        LIMIT  1
      ) sa ON true
      WHERE $1::uuid IS NULL OR c.claimant_id = $1::uuid
      ORDER BY c.submitted_at DESC
      LIMIT 50
    `, [ownerFilter]);

    const claims: ClaimRow[] = result.rows.map((row) => {
      const amount = parseFloat(row.claimed_amount);
      return {
        claimId: row.claim_id,
        id: shortClaimId(row.claim_id),
        claimant: row.full_name,
        type: row.claim_type ?? "Insurance claim",
        amount: `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
        date: new Date(row.submitted_at).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        status: statusLabel(row.claim_status, row.decision_status),
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
