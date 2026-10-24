"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardStats, ClaimRow } from "@/app/types";

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
const navigation = [
  { label: "Overview", icon: "◫" },
  { label: "Claims", icon: "▤" },
  { label: "Fraud screening", icon: "⌕" },
  { label: "Reviews & decisions", icon: "☷" },
  { label: "Reference cases", icon: "▦" },
  { label: "Notifications", icon: "♧" },
  { label: "Audit history", icon: "◷" },
  { label: "Reports", icon: "▥" },
] as const;

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------
function riskStyle(risk: string): React.CSSProperties {
  if (risk === "High") return { background: "#fff0ed", color: "#b93827" };
  if (risk === "Medium") return { background: "#fff6df", color: "#946200" };
  if (risk === "Low") return { background: "#e6f7ef", color: "#16794b" };
  return { background: "#edf1f7", color: "#5c6b80" };
}

function statusStyle(status: string): React.CSSProperties {
  if (status === "Approved" || status === "Decided")
    return { background: "#e6f7ef", color: "#16794b" };
  if (status === "Under review")
    return { background: "#edf1ff", color: "#3154c8" };
  if (status === "Information needed")
    return { background: "#fff6df", color: "#946200" };
  if (status === "Screening")
    return { background: "#f2f0ff", color: "#5b45c8" };
  return { background: "#edf1f7", color: "#5c6b80" };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  icon,
  value,
  note,
  loading,
  error,
}: {
  label: string;
  icon: string;
  value: number | null;
  note?: string;
  loading: boolean;
  error: boolean;
}) {
  return (
    <article className="panel p-5">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-500">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edf1ff] text-lg text-[#315ee7]">
          {icon}
        </span>
      </div>
      {loading ? (
        <div className="skeleton-line h-8 w-16 rounded" />
      ) : error ? (
        <p className="text-sm text-slate-400">—</p>
      ) : (
        <p className="text-3xl font-bold tracking-tight text-[#172b4d]">
          {value ?? 0}
        </p>
      )}
      {note && !loading && !error && (
        <p className="mt-2 text-xs text-slate-500">{note}</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const [active, setActive] = useState<string>("Overview");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All claims");

  // Stats state
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Claims state
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState<string | null>(null);

  // Fetch dashboard stats
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      const data: DashboardStats = await res.json();
      setStats(data);
    } catch (err: unknown) {
      setStatsError(
        err instanceof Error ? err.message : "Could not load statistics."
      );
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Fetch claims list
  const fetchClaims = useCallback(async () => {
    setClaimsLoading(true);
    setClaimsError(null);
    try {
      const res = await fetch("/api/claims");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      const data: { claims: ClaimRow[] } = await res.json();
      if (!Array.isArray(data.claims)) throw new Error("Unexpected response.");
      setClaims(data.claims);
    } catch (err: unknown) {
      setClaimsError(
        err instanceof Error ? err.message : "Could not load claims."
      );
    } finally {
      setClaimsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    void fetchClaims();
  }, [fetchStats, fetchClaims]);

  // Derive unique filter statuses from actual data
  const filterOptions = useMemo(
    () => [
      "All claims",
      ...Array.from(new Set(claims.map((c) => c.status))).sort(),
    ],
    [claims]
  );

  const visibleClaims = useMemo(
    () =>
      claims.filter((claim) => {
        const matchesSearch = `${claim.id} ${claim.claimant} ${claim.type}`
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesFilter =
          filter === "All claims" || claim.status === filter;
        return matchesSearch && matchesFilter;
      }),
    [claims, search, filter]
  );

  // Today's date formatted
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const metricCards = [
    {
      label: "Total claims",
      icon: "▤",
      value: stats?.totalClaims ?? null,
    },
    {
      label: "Awaiting review",
      icon: "◷",
      value: stats?.awaitingReview ?? null,
    },
    {
      label: "Flagged for investigation",
      icon: "⌕",
      value: stats?.flaggedForInvestigation ?? null,
    },
    {
      label: "Decisions recorded",
      icon: "✓",
      value: stats?.decisionsRecorded ?? null,
    },
  ];

  const pendingReviewCount = stats?.awaitingReview ?? null;

  return (
    <div className="min-h-screen md:flex">
      {/* ----------------------------------------------------------------- */}
      {/* Sidebar                                                            */}
      {/* ----------------------------------------------------------------- */}
      <aside className="sidebar fixed inset-y-0 left-0 z-10 flex w-[248px] flex-col bg-[#152b4d] px-4 py-6 text-white">
        <a href="#" className="mb-9 flex items-center gap-3 px-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#315ee7] text-xl font-bold">
            C
          </span>
          <span>
            <span className="block text-lg font-bold tracking-tight">
              ClaimGuard
            </span>
            <span className="text-xs text-slate-400">Claims intelligence</span>
          </span>
        </a>

        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">
          Workspace
        </p>
        <nav className="flex flex-col gap-1">
          {navigation.map((item) => (
            <button
              key={item.label}
              onClick={() => setActive(item.label)}
              className={`sidebar-link text-left ${active === item.label ? "active" : ""}`}
            >
              <span className="w-5 text-center text-lg">{item.icon}</span>
              <span className="text-[13px] font-medium">{item.label}</span>
              {item.label === "Reviews & decisions" &&
                pendingReviewCount !== null &&
                pendingReviewCount > 0 && (
                  <span className="ml-auto rounded-md bg-[#dbe6ff] px-2 py-0.5 text-[10px] font-bold text-[#2446a5]">
                    {pendingReviewCount}
                  </span>
                )}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Connected to database
          </div>
          <p className="text-xs leading-5 text-slate-400">
            Displaying live data from the ClaimGuard PostgreSQL instance.
          </p>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-white/10 px-2 pt-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dce7ff] font-bold text-[#2446a5]">
            HA
          </div>
          <div>
            <p className="text-sm font-semibold">Claims administrator</p>
            <p className="text-xs text-slate-400">Insurance operations</p>
          </div>
        </div>
      </aside>

      {/* ----------------------------------------------------------------- */}
      {/* Main content                                                       */}
      {/* ----------------------------------------------------------------- */}
      <main className="min-w-0 flex-1 md:ml-[248px]">
        {/* Header */}
        <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#e5eaf1] bg-white px-5 py-4 md:px-9">
          <div>
            <p className="text-xs text-slate-500">ClaimGuard / {active}</p>
            <h1 className="mt-1 text-lg font-bold text-[#172b4d]">
              {active === "Overview" ? "Claims overview" : active}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              Insurance operations
            </span>
            <button
              aria-label="Notifications"
              onClick={() => setActive("Notifications")}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-lg hover:bg-slate-50"
            >
              ♧
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e7edff] text-xs font-bold text-[#3154c8]">
              HA
            </div>
          </div>
        </header>

        <div className="page-content mx-auto max-w-[1500px] p-5 md:p-9">
          {/* Greeting row */}
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500" suppressHydrationWarning>
                {today}
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#172b4d]">
                Good morning
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Here is the current overview of your claims workspace.
              </p>
            </div>
            <button
              onClick={() => setActive("Claims")}
              className="rounded-lg bg-[#315ee7] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#2449c6]"
            >
              + New claim
            </button>
          </div>

          {/* Stats error banner */}
          {statsError && (
            <div
              role="alert"
              className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800"
            >
              <div>
                <strong>Could not load statistics:</strong> {statsError}
              </div>
              <button
                onClick={() => void fetchStats()}
                className="font-semibold text-[#315ee7] underline hover:text-[#2449c6]"
              >
                Retry
              </button>
            </div>
          )}

          {/* Metric cards */}
          <section className="metric-grid mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metricCards.map((metric) => (
              <StatCard
                key={metric.label}
                label={metric.label}
                icon={metric.icon}
                value={metric.value}
                loading={statsLoading}
                error={!!statsError}
              />
            ))}
          </section>

          {/* Charts row */}
          <section className="dashboard-grid mb-7 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
            {/* Claims by status breakdown */}
            <article className="panel p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[#172b4d]">
                    Claims by status
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {claimsLoading
                      ? "Loading…"
                      : `${claims.length} claim${claims.length === 1 ? "" : "s"} in the database`}
                  </p>
                </div>
              </div>
              {claimsLoading ? (
                <div className="flex h-[170px] items-center justify-center">
                  <span className="text-sm text-slate-400">Loading…</span>
                </div>
              ) : claimsError ? (
                <div className="flex h-[170px] flex-col items-center justify-center gap-2 text-center">
                  <span className="text-sm text-red-500">
                    Could not load claim data.
                  </span>
                  <button
                    onClick={() => void fetchClaims()}
                    className="text-xs font-semibold text-[#315ee7] underline hover:text-[#2449c6]"
                  >
                    Try again
                  </button>
                </div>
              ) : claims.length === 0 ? (
                <div className="flex h-[170px] flex-col items-center justify-center gap-2 text-center">
                  <span className="text-2xl">▤</span>
                  <p className="text-sm font-medium text-slate-500">
                    No claims in the database
                  </p>
                  <p className="max-w-[260px] text-xs text-slate-400">
                    Claims submitted through the system will appear here.
                  </p>
                </div>
              ) : (
                (() => {
                  // Count claims per status for a simple bar chart
                  const counts = claims.reduce<Record<string, number>>(
                    (acc, c) => {
                      acc[c.status] = (acc[c.status] ?? 0) + 1;
                      return acc;
                    },
                    {}
                  );
                  const entries = Object.entries(counts).sort(
                    ([, a], [, b]) => b - a
                  );
                  const max = Math.max(...entries.map(([, v]) => v), 1);
                  return (
                    <div className="space-y-3">
                      {entries.map(([status, count]) => (
                        <div key={status}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-slate-600">{status}</span>
                            <span className="font-semibold text-[#172b4d]">
                              {count}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-[#7e9bf7]"
                              style={{ width: `${(count / max) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
            </article>

            {/* Screening summary */}
            <article className="panel p-5">
              <h3 className="font-bold text-[#172b4d]">Screening summary</h3>
              <p className="mt-1 text-xs text-slate-500">
                Advisory risk distribution
              </p>
              {claimsLoading ? (
                <div className="mt-6 space-y-5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="skeleton-line h-4 rounded" />
                  ))}
                </div>
              ) : claimsError ? (
                <div className="mt-6 flex flex-col items-start gap-2">
                  <p className="text-sm text-red-500">
                    Could not load screening data.
                  </p>
                  <button
                    onClick={() => void fetchClaims()}
                    className="text-xs font-semibold text-[#315ee7] underline hover:text-[#2449c6]"
                  >
                    Try again
                  </button>
                </div>
              ) : claims.length === 0 ? (
                <p className="mt-6 text-sm text-slate-400">
                  No screening data available.
                </p>
              ) : (
                (() => {
                  const riskCounts = claims.reduce<Record<string, number>>(
                    (acc, c) => {
                      const key =
                        c.risk === "Pending" ? "Not yet screened" : c.risk;
                      acc[key] = (acc[key] ?? 0) + 1;
                      return acc;
                    },
                    {}
                  );
                  const order = [
                    "Low",
                    "Medium",
                    "High",
                    "Not yet screened",
                  ];
                  const colorMap: Record<string, string> = {
                    Low: "#27966b",
                    Medium: "#e6a12a",
                    High: "#d85448",
                    "Not yet screened": "#9aacbf",
                  };
                  const total = claims.length;
                  const items = order
                    .filter((k) => riskCounts[k])
                    .map((k) => ({
                      label: `${k} advisory risk`,
                      pct: Math.round(((riskCounts[k] ?? 0) / total) * 100),
                      color: colorMap[k] ?? "#9aacbf",
                    }));
                  return (
                    <div className="mt-6 space-y-5">
                      {items.map((item) => (
                        <div key={item.label}>
                          <div className="mb-2 flex justify-between text-xs">
                            <span className="text-slate-600">{item.label}</span>
                            <span className="font-bold text-[#172b4d]">
                              {item.pct}%
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${item.pct}%`,
                                background: item.color,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
              <p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                Risk indicators support investigation. They are not proof of
                fraud and must not replace a qualified adjuster&apos;s decision.
              </p>
            </article>
          </section>

          {/* Recent claims table */}
          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <h3 className="font-bold text-[#172b4d]">Recent claims</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {claimsLoading
                    ? "Loading claims…"
                    : claimsError
                      ? "Error loading claims"
                      : `${claims.length} record${claims.length === 1 ? "" : "s"} from the database`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label="Search claims"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search claims…"
                  disabled={claimsLoading || !!claimsError}
                  className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400 disabled:opacity-50"
                />
                <select
                  aria-label="Filter by status"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  disabled={claimsLoading || !!claimsError}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 disabled:opacity-50"
                >
                  {filterOptions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    void fetchStats();
                    void fetchClaims();
                  }}
                  disabled={claimsLoading || statsLoading}
                  aria-label="Refresh data"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>

            {/* Table body */}
            {claimsError ? (
              <div
                role="alert"
                className="px-5 py-10 text-center text-sm text-red-500"
              >
                {claimsError}
                <button
                  onClick={() => void fetchClaims()}
                  className="ml-3 text-[#315ee7] underline"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="claims-table w-full border-collapse text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Claim ID</th>
                      <th className="px-5 py-3 font-semibold">Claimant</th>
                      <th className="px-5 py-3 font-semibold">Description</th>
                      <th className="px-5 py-3 font-semibold">Amount</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Advisory risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {claimsLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 6 }).map((__, j) => (
                            <td key={j} className="px-5 py-4">
                              <div className="skeleton-line h-3 rounded" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : visibleClaims.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-5 py-16 text-center text-sm text-slate-400"
                        >
                          {claims.length === 0 ? (
                            <span>
                              No claims have been submitted yet.
                              <br />
                              <span className="text-xs">
                                Claims entered into the system will appear here.
                              </span>
                            </span>
                          ) : (
                            "No claims match your search."
                          )}
                        </td>
                      </tr>
                    ) : (
                      visibleClaims.map((claim) => (
                        <tr
                          key={claim.id}
                          className="hover:bg-slate-50/70 transition-colors"
                        >
                          <td className="whitespace-nowrap px-5 py-4 text-xs font-bold text-[#3154c8]">
                            {claim.id}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-xs font-semibold text-[#172b4d]">
                            {claim.claimant}
                            <span className="mt-1 block font-normal text-slate-400">
                              {claim.date}
                            </span>
                          </td>
                          <td className="max-w-[220px] truncate px-5 py-4 text-xs text-slate-600">
                            {claim.type}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-xs font-semibold text-[#172b4d]">
                            {claim.amount}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <span
                              className="status-pill"
                              style={statusStyle(claim.status)}
                            >
                              {claim.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <span
                              className="status-pill"
                              style={riskStyle(claim.risk)}
                            >
                              {claim.risk}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              {claimsLoading
                ? "Loading…"
                : claimsError
                  ? "—"
                  : `Showing ${visibleClaims.length} of ${claims.length} records`}
            </div>
          </section>

          <footer className="mt-7 flex flex-wrap justify-between gap-2 text-[11px] text-slate-400">
            <span>ClaimGuard · Insurance claims operations</span>
            <span>Risk assessment is advisory · Human decision required</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
