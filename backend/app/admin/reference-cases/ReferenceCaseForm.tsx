"use client";

import { useState } from "react";

/** Create (POST) or edit (PATCH → new version) a reference fraud case. */
export default function ReferenceCaseForm({
  caseId,
  initialTitle = "",
  initialDescription = "",
}: {
  caseId?: string;
  initialTitle?: string;
  initialDescription?: string;
}) {
  const editing = Boolean(caseId);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/reference-cases/${caseId}` : "/api/reference-cases", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.href = `/admin/reference-cases/${body.caseId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the case.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-4 p-6">
      {editing && (
        <p className="rounded-lg bg-[#eef3ff] px-4 py-3 text-xs leading-5 text-[#2446a5]">
          Reference cases are never changed in place, because past screening results point at
          the exact text that was matched. Saving creates a new, re-embedded version and
          deactivates this one; this version stays in the history.
        </p>
      )}
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={5}
          maxLength={150}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-slate-600">
          Description (this text is embedded and compared with new claims)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          minLength={30}
          maxLength={5000}
          rows={7}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6"
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button
          disabled={busy}
          className="rounded-lg bg-[#315ee7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2446a5] disabled:opacity-50"
        >
          {busy ? "Embedding and saving…" : editing ? "Save as new version" : "Create case"}
        </button>
        <a
          href="/admin/reference-cases"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
