import { notFound, redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { getClaimDetail } from "@/app/lib/claims";
import { getCaseFile } from "@/app/lib/caseFile";
import { isUuid } from "@/app/lib/http";
import { STATUS_LABEL, fmtDateTime, money, shortClaimId } from "@/app/lib/format";
import SimpleShell from "@/app/components/SimpleShell";
import SimilarityBar from "@/app/components/SimilarityBar";
import RescreenButton from "@/app/components/RescreenButton";
import { RiskPill } from "@/app/components/Pills";
import ReviewActions from "./ReviewActions";

export const metadata = { title: "Claim review | ClaimGuard" };

const ACTION_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  INFO_REQUESTED: "Requested information",
};

// Claims adjusters review here; admins can open it read-only.
export default async function AdjusterClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "POLICYHOLDER") redirect(homePathFor(user.role));

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [claim, file] = await Promise.all([getClaimDetail(id, user), getCaseFile(id)]);
  if (!claim || !file || !claim.evidence) notFound();

  const decided = claim.claimStatus === "DECIDED";
  const latest = claim.evidence.assessments[0];
  const canReview = user.role === "CLAIMS_ADJUSTER" && !decided;
  const canRescreen = !decided && claim.screeningStatus !== "COMPLETED";

  return (
    <SimpleShell
      user={user}
      title={`Claim ${shortClaimId(claim.claimId)}`}
      subtitle={`${claim.claimantName} · ${file.policy.policyNumber} · ${
        claim.decisionStatus ? `Decided: ${claim.decisionStatus.toLowerCase()}` : STATUS_LABEL[claim.claimStatus]
      }`}
      backHref="/adjuster/queue"
      backLabel="Back to review queue"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        {/* Left: claim, policy, history, actions */}
        <div className="space-y-6">
          <div className="panel space-y-2 p-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <RiskPill screeningStatus={claim.screeningStatus} risk={latest?.riskIndicator ?? null} />
              {claim.evidence.reviewRequired && (
                <span className="status-pill bg-red-50 text-red-700">Human review required</span>
              )}
            </div>
            <p><span className="font-semibold">Incident date:</span> {claim.incidentDate}</p>
            <p><span className="font-semibold">Amount:</span> {money(claim.claimedAmount)}</p>
            <p><span className="font-semibold">Submitted:</span> {fmtDateTime(claim.submittedAt)}</p>
            <p className="whitespace-pre-line border-t border-slate-100 pt-3 leading-6 text-slate-700">{claim.description}</p>
          </div>

          <div className="panel space-y-1 p-5 text-xs text-slate-600">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Policy</p>
            <p><span className="font-semibold text-slate-700">{file.policy.policyNumber}</span> · {file.policy.isActive ? "active" : "inactive"}</p>
            <p>Coverage {file.policy.effectiveDate} to {file.policy.expiryDate}</p>
            <p>Holder {file.policy.holderName} ({file.policy.holderEmail})</p>
            <p>Other claims on this policy: {file.policy.otherClaims}</p>
          </div>

          <div className="panel p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Review history</p>
            {file.reviews.length === 0 ? (
              <p className="text-sm text-slate-500">No reviews yet.</p>
            ) : (
              <ol className="space-y-4">
                {file.reviews.map((r) => (
                  <li key={r.reviewId} className="text-sm">
                    <p className="font-medium text-[#172b4d]">
                      {ACTION_LABEL[r.action] ?? r.action}
                      <span className="font-normal text-slate-500"> · {r.reviewer} · {fmtDateTime(r.reviewedAt)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{r.notes}</p>
                    {r.attemptNo !== null && (
                      <p className="text-[11px] text-slate-400">Based on screening attempt {r.attemptNo}</p>
                    )}
                    {r.action === "INFO_REQUESTED" && (
                      r.response ? (
                        <div className="mt-2 rounded-lg bg-[#eef3ff] px-3 py-2 text-xs leading-5 text-[#172b4d]">
                          <p className="font-semibold">Policyholder answered · {fmtDateTime(r.response.respondedAt)}</p>
                          <p className="whitespace-pre-line">{r.response.body}</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-amber-700">Waiting for the policyholder&apos;s answer</p>
                      )
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {canReview && <ReviewActions claimId={claim.claimId} />}
          {user.role === "ADMIN" && !decided && (
            <p className="text-xs text-slate-500">Read-only: only claims adjusters record reviews.</p>
          )}
        </div>

        {/* Right: screening evidence */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[#172b4d]">Screening evidence</p>
            {canRescreen && <RescreenButton claimId={claim.claimId} />}
          </div>
          {claim.evidence.assessments.length === 0 && (
            <p className="panel p-5 text-sm text-slate-500">Not screened yet.</p>
          )}
          {claim.evidence.assessments.map((a) => (
            <div key={a.assessmentId} className="panel p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-700">Attempt {a.attemptNo}</span>
                <span className={`status-pill ${a.status === "FAILED" ? "bg-slate-100 text-slate-600" : "bg-[#eef3ff] text-[#2446a5]"}`}>
                  {a.status === "FAILED" ? "Screening failed" : a.outcome === "MATCHES_FOUND" ? "Matches found" : "No match"}
                </span>
                {a.riskIndicator && (
                  <span className="text-slate-600">{a.riskIndicator} risk · rule {a.riskRuleVersion}</span>
                )}
                <span className="ml-auto text-slate-400">{fmtDateTime(a.createdAt)}</span>
              </div>
              {a.status === "FAILED" ? (
                <p className="mt-3 text-xs text-slate-600">
                  {a.failureReason}. No risk result was recorded; this is not “low risk”.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[11px] text-slate-400">
                    {a.modelName} ({a.modelVersion}) · top {a.topK} confirmed fraud cases by cosine similarity
                  </p>
                  <ol className="mt-3 space-y-3">
                    {a.matches.map((m) => (
                      <li key={m.rank}>
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="text-slate-700">
                            {m.rank}. {m.title}
                            {!m.caseActive && <span className="text-slate-400"> (since deactivated)</span>}
                          </span>
                          <span className="font-mono font-semibold">{m.similarity.toFixed(3)}</span>
                        </div>
                        <SimilarityBar value={m.similarity} />
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          ))}
          <p className="text-[11px] text-slate-400">
            Similarity and risk are advisory evidence for the adjuster, not proof of fraud.
          </p>
        </div>
      </div>
    </SimpleShell>
  );
}
