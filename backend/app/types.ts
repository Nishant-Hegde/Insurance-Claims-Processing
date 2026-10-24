/**
 * Shared TypeScript interfaces for ClaimGuard API routes and client components.
 *
 * This file must NOT import from "next/server" or any other server-only
 * module. It is imported by both server-side route handlers and the
 * "use client" dashboard page, so it must be safe for both runtimes.
 */

export interface DashboardStats {
  totalClaims: number;
  awaitingReview: number;
  flaggedForInvestigation: number;
  decisionsRecorded: number;
}

export interface ClaimRow {
  id: string;
  claimant: string;
  type: string;
  /** Formatted amount string, e.g. "₹84,500.00" */
  amount: string;
  /** Submission date formatted for display */
  date: string;
  status: string;
  /** Advisory risk label: "High" | "Medium" | "Low" | "Pending" */
  risk: string;
}

export interface ClaimsResponse {
  claims: ClaimRow[];
}
