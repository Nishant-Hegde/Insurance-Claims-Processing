import { redirect } from "next/navigation";
import pool from "@/app/db/pool";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import SimpleShell from "@/app/components/SimpleShell";
import { ROLE_LABELS, type Role } from "@/app/types";
import UserStatusButton from "./UserStatusButton";

export const metadata = { title: "Users & sessions | ClaimGuard" };

// Admin only: every user, their role, live sessions, and activation.
export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(homePathFor(user.role));

  const { rows } = await pool.query<{
    user_id: string;
    full_name: string;
    email: string;
    role_name: Role;
    is_active: boolean;
    live_sessions: number;
  }>(
    `SELECT u.user_id, u.full_name, u.email, r.role_name, u.is_active,
            (SELECT count(*)::int FROM v_active_session s
             WHERE s.user_id = u.user_id) AS live_sessions
     FROM app_user u
     JOIN app_role r ON r.role_id = u.role_id
     ORDER BY r.role_id DESC, u.full_name`
  );

  return (
    <SimpleShell
      user={user}
      title="Users & sessions"
      subtitle="Deactivating a user signs them out everywhere immediately (database trigger). Accounts are never deleted."
    >
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Live sessions</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 font-medium text-[#172b4d]">{r.full_name}</td>
                <td className="px-5 py-3 text-slate-600">{r.email}</td>
                <td className="px-5 py-3">{ROLE_LABELS[r.role_name]}</td>
                <td className="px-5 py-3">
                  {r.is_active ? (
                    <span className="text-emerald-700">Active</span>
                  ) : (
                    <span className="text-slate-400">Deactivated</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">{r.live_sessions}</td>
                <td className="px-5 py-3 text-right">
                  {r.user_id === user.userId ? (
                    <span className="text-xs text-slate-400">You</span>
                  ) : (
                    <UserStatusButton userId={r.user_id} name={r.full_name} isActive={r.is_active} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SimpleShell>
  );
}
