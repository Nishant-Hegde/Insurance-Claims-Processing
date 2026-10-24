import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import type { DashboardStats } from "@/app/types";

export async function GET(): Promise<NextResponse> {
  try {
    const result = await pool.query<{
      total_claims: string;
      awaiting_review: string;
      flagged: string;
      decisions_recorded: string;
    }>(`
      SELECT
        COUNT(*)::int                                          AS total_claims,
        COUNT(*) FILTER (WHERE claim_status = 'UNDER_REVIEW')::int AS awaiting_review,
        COUNT(*) FILTER (
          WHERE review_required = true
            AND claim_status NOT IN ('DECIDED')
        )::int                                                 AS flagged,
        (SELECT COUNT(*)::int FROM claim_decision)             AS decisions_recorded
      FROM claim
    `);

    const row = result.rows[0];
    const stats: DashboardStats = {
      totalClaims: Number(row.total_claims),
      awaitingReview: Number(row.awaiting_review),
      flaggedForInvestigation: Number(row.flagged),
      decisionsRecorded: Number(row.decisions_recorded),
    };

    return NextResponse.json(stats);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown database error";
    console.error("[/api/dashboard/stats]", message);
    return NextResponse.json(
      { error: "Failed to load dashboard statistics." },
      { status: 503 }
    );
  }
}
