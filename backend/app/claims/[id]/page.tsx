import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/app/lib/auth";
import { isUuid } from "@/app/lib/http";

// Old shared link: send each role to its own claim page.
export default async function ClaimRedirect({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  redirect(user.role === "POLICYHOLDER" ? `/my-claims/${id}` : `/adjuster/claims/${id}`);
}
