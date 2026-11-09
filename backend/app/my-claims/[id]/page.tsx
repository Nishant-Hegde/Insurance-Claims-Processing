import { notFound, redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { getClaimDetail } from "@/app/lib/claims";
import { isUuid } from "@/app/lib/http";
import { claimTimeline, outstandingRequest } from "@/app/lib/timeline";
import { STATUS_LABEL, fmtDateTime, money, shortClaimId } from "@/app/lib/format";
import SimpleShell from "@/app/components/SimpleShell";
import ResponseForm from "./ResponseForm";

export const metadata = { title: "My claim | ClaimGuard" };

const DOT: Record<string, string> = {
  REVIEW_INFO_REQUESTED: "bg-amber-500",
  REVIEW_APPROVED: "bg-emerald-500",
  REVIEW_REJECTED: "bg-red-500",
  DECISION: "bg-[#172b4d]",
  RESPONSE: "bg-[#315ee7]",
};

// The policyholder's own claim: details, status timeline, and the answer form when asked.
export default async function MyClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "POLICYHOLDER") redirect(homePathFor(user.role));

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const claim = await getClaimDetail(id, user); // returns null for someone else's claim
  if (!claim) notFound();
  const [timeline, pending] = await Promise.all([claimTimeline(id), outstandingRequest(id)]);

  const status = claim.decisionStatus
    ? claim.decisionStatus === "APPROVED" ? "Approved" : "Rejected"
    : STATUS_LABEL[claim.claimStatus] ?? claim.claimStatus;

  return (
    <SimpleShell
      user={user}
      title={`Claim ${shortClaimId(claim.claimId)}`}
      subtitle={`${claim.policyNumber} · ${status}`}
      backHref="/my-claims"
      backLabel="Back to my claims"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <div className="panel space-y-2 p-6 text-sm">
            <p><span className="font-semibold">Incident date:</span> {claim.incidentDate}</p>
            <p><span className="font-semibold">Amount:</span> {money(claim.claimedAmount)}</p>
            <p><span className="font-semibold">Status:</span> {status}</p>
            <p className="whitespace-pre-line border-t border-slate-100 pt-3 leading-6 text-slate-700">{claim.description}</p>
          </div>

          {pending && (
            <div className="panel border-amber-200 p-6">
              <p className="text-sm font-semibold text-[#172b4d]">The adjuster needs more information</p>
              <p className="mt-2 whitespace-pre-line rounded-lg bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                {pending.question}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Asked {fmtDateTime(pending.requestedAt)}</p>
              <ResponseForm claimId={claim.claimId} />
            </div>
          )}
        </div>

        <div className="panel p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</p>
          <ol className="relative space-y-5 border-l border-slate-200 pl-5">
            {timeline.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${DOT[e.kind] ?? "bg-slate-400"}`} />
                <p className="text-sm font-medium text-[#172b4d]">{e.title}</p>
                <p className="text-[11px] text-slate-400">{fmtDateTime(e.at)}</p>
                {e.detail && <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </SimpleShell>
  );
}
