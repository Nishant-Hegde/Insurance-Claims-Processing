import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import SimpleShell from "@/app/components/SimpleShell";
import SimilarSearch from "./SimilarSearch";

export const metadata = { title: "Similarity search | ClaimGuard" };

// Claims adjusters and admins: type any text, see the nearest confirmed fraud patterns.
export default async function SimilarPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "POLICYHOLDER") redirect(homePathFor(user.role));

  return (
    <SimpleShell
      user={user}
      title="Similarity search"
      subtitle="Describe an incident in your own words. ClaimGuard embeds it and finds the closest confirmed fraud patterns by meaning, not keywords."
    >
      <SimilarSearch />
    </SimpleShell>
  );
}
