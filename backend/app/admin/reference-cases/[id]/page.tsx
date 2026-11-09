import { notFound, redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { isUuid } from "@/app/lib/http";
import { getReferenceCase } from "@/app/lib/referenceCases";
import SimpleShell from "@/app/components/SimpleShell";
import ReferenceCaseForm from "../ReferenceCaseForm";

export const metadata = { title: "Reference case | ClaimGuard" };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ReferenceCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(homePathFor(user.role));

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const c = await getReferenceCase(id);
  if (!c) notFound();

  return (
    <SimpleShell user={user} title={c.title} subtitle={c.isActive ? "Active reference case" : "Inactive reference case (history)"} backHref="/admin/reference-cases"
      backLabel="Back to reference cases">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {c.isActive ? (
            <ReferenceCaseForm caseId={c.caseId} initialTitle={c.title} initialDescription={c.description} />
          ) : (
            <div className="panel p-6">
              <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{c.description}</p>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="panel space-y-2 p-5 text-xs text-slate-600">
            <p><span className="font-semibold text-slate-700">Model:</span> {c.modelName} ({c.modelVersion})</p>
            <p><span className="font-semibold text-slate-700">Created:</span> {fmt(c.createdAt)} by {c.createdBy}</p>
            {c.deactivatedAt && (
              <p><span className="font-semibold text-slate-700">Deactivated:</span> {fmt(c.deactivatedAt)} by {c.deactivatedBy}</p>
            )}
            <p><span className="font-semibold text-slate-700">Used in screening matches:</span> {c.matchCount}</p>
            <p className="break-all font-mono text-[11px] text-slate-400">{c.caseId}</p>
          </div>

          <div className="panel p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Version history</p>
            <ol className="space-y-2 text-xs">
              {c.versions.map((v) => (
                <li key={v.caseId} className={v.depth === 0 ? "font-semibold text-[#172b4d]" : "text-slate-600"}>
                  <a href={`/admin/reference-cases/${v.caseId}`} className="hover:underline">
                    {v.depth === 0 ? "This version" : v.depth < 0 ? "Older version" : "Newer version"}
                  </a>{" "}
                  · {fmt(v.createdAt)} · {v.isActive ? "active" : "inactive"}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </SimpleShell>
  );
}
