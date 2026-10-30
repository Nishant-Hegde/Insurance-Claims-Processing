"use client";

import { useState } from "react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirectTo?: string;
      };
      if (!res.ok || !body.redirectTo) {
        setError(body.error ?? "Sign-in failed.");
        return;
      }
      window.location.href = body.redirectTo;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#315ee7] focus:ring-2 focus:ring-[#315ee7]/20";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
        Email
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-[#315ee7] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2449c6] disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
