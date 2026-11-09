/** Display helpers shared by server and client components. */

export const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  AWAITING_INFO: "Information needed",
  DECIDED: "Decided",
};

export function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function money(amount: number | string): string {
  return `₹${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Last 8 hex digits: the random part of a v4 UUID (seed ids share their first 8). */
export function shortClaimId(claimId: string): string {
  return `CL-${claimId.slice(-8).toUpperCase()}`;
}
