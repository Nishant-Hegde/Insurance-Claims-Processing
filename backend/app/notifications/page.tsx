import { redirect } from "next/navigation";
import { getSessionUser } from "@/app/lib/auth";
import { listNotifications } from "@/app/lib/notifications";
import SimpleShell from "@/app/components/SimpleShell";
import NotificationList from "./NotificationList";

export const metadata = { title: "Notifications | ClaimGuard" };

// Every role: own notifications only (WHERE user_id = session user).
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const showAll = (await searchParams).show === "all";
  const items = await listNotifications(user.userId, showAll);
  const claimBase = user.role === "POLICYHOLDER" ? "/my-claims" : "/adjuster/claims";

  return (
    <SimpleShell
      user={user}
      title="Notifications"
      subtitle="Updates about your claims and work. Dismissed notifications are kept as history."
    >
      <NotificationList items={items} showAll={showAll} claimBase={claimBase} />
    </SimpleShell>
  );
}
