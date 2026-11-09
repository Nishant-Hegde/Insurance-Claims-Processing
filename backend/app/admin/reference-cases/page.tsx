import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import SimpleShell from "@/app/components/SimpleShell";
import ReferenceCasesTable from "./ReferenceCasesTable";

export const metadata = { title: "Reference fraud cases | ClaimGuard" };

// Admin only: the confirmed fraud patterns that new claims are compared against.
export default async function ReferenceCasesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(homePathFor(user.role));

  return (
    <SimpleShell
      user={user}
      title="Reference fraud cases"
      subtitle="Confirmed fraud patterns used for similarity screening. Only active cases are searched."
    >
      <ReferenceCasesTable />
    </SimpleShell>
  );
}
