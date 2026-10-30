import type { SessionUser } from "@/app/types";
import { ROLE_LABELS } from "@/app/types";
import LogoutButton from "@/app/components/LogoutButton";

/** Plain page frame for the policyholder and admin pages. */
export default function SimpleShell({
  user,
  title,
  subtitle,
  backHref,
  children,
}: {
  user: SessionUser;
  title: string;
  subtitle?: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f4f6fa]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5eaf1] bg-white px-5 py-4 md:px-9">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#315ee7] font-bold text-white">
            C
          </span>
          <div>
            <p className="text-sm font-bold text-[#172b4d]">ClaimGuard</p>
            {backHref && (
              <a href={backHref} className="text-xs text-[#315ee7] hover:underline">
                ← Back to dashboard
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold text-[#172b4d]">{user.fullName}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
          <LogoutButton className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" />
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] p-5 md:p-9">
        <h1 className="text-2xl font-bold tracking-tight text-[#172b4d]">{title}</h1>
        {subtitle && <p className="mt-1 mb-6 text-sm text-slate-500">{subtitle}</p>}
        {children}
      </main>
    </div>
  );
}
