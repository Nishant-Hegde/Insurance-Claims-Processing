/** Small status badges shared by staff pages. */

const RISK_STYLE: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700",
  MEDIUM: "bg-amber-50 text-amber-700",
  LOW: "bg-emerald-50 text-emerald-700",
};

/** A failed or missing screening is shown as such, never as low risk. */
export function RiskPill({ screeningStatus, risk }: { screeningStatus: string; risk: string | null }) {
  if (screeningStatus === "FAILED") return <span className="status-pill bg-slate-100 text-slate-600">Screening failed</span>;
  if (screeningStatus === "PENDING" || !risk) return <span className="status-pill bg-slate-100 text-slate-500">Not screened</span>;
  return <span className={`status-pill ${RISK_STYLE[risk] ?? "bg-slate-100 text-slate-600"}`}>{risk}</span>;
}
