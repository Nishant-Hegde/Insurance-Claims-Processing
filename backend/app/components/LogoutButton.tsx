"use client";

import { useState } from "react";

export default function LogoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <button onClick={() => void logout()} disabled={busy} className={className}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
