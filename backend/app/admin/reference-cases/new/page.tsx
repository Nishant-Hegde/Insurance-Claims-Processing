import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import SimpleShell from "@/app/components/SimpleShell";
import ReferenceCaseForm from "../ReferenceCaseForm";

export const metadata = { title: "New reference case | ClaimGuard" };

export default async function NewReferenceCasePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect(homePathFor(user.role));

  return (
    <SimpleShell
      user={user}
      title="New reference case"
      subtitle="Add a confirmed fraud pattern. Its description is embedded and becomes searchable immediately."
      backHref="/admin/reference-cases"
      backLabel="Back to reference cases"
    >
      <div className="max-w-3xl">
        <ReferenceCaseForm />
      </div>
    </SimpleShell>
  );
}
