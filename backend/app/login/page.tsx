import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/app/lib/auth";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in | ClaimGuard" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6fa] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#315ee7] text-xl font-bold text-white">
            C
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight text-[#172b4d]">ClaimGuard</p>
            <p className="text-xs text-slate-500">Claims intelligence</p>
          </div>
        </div>
        <div className="panel p-6">
          <h1 className="text-lg font-bold text-[#172b4d]">Sign in</h1>
          <p className="mt-1 mb-5 text-sm text-slate-500">
            Policyholders, claims adjusters and administrators sign in here.
          </p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
