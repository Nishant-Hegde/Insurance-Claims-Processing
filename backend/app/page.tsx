import { redirect } from "next/navigation";
import Dashboard from "@/app/components/Dashboard";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import { unreadNotificationCount } from "@/app/lib/notifications";

// Staff dashboard: claims adjusters and admins only.
export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "POLICYHOLDER") redirect(homePathFor(user.role));
  const unread = await unreadNotificationCount(user.userId).catch(() => 0);
  return <Dashboard user={user} unread={unread} />;
}
