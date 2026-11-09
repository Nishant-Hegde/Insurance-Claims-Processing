/**
 * Shared TypeScript interfaces for ClaimGuard API routes and client components.
 *
 * This file must NOT import from "next/server" or any other server-only
 * module. It is imported by both server-side route handlers and the
 * "use client" dashboard page, so it must be safe for both runtimes.
 */

/** Role names as stored in app_role.role_name. */
export type Role = "POLICYHOLDER" | "CLAIMS_ADJUSTER" | "ADMIN";

export const ROLE_LABELS: Record<Role, string> = {
  POLICYHOLDER: "Policyholder",
  CLAIMS_ADJUSTER: "Claims adjuster",
  ADMIN: "Administrator",
};

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface DashboardStats {
  totalClaims: number;
  awaitingReview: number;
  flaggedForInvestigation: number;
  decisionsRecorded: number;
}

export interface ClaimRow {
  /** Full claim UUID, used for the detail link. */
  claimId: string;
  /** Short display id, e.g. "CL-D1000000". */
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
