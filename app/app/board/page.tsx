"use client";

import { useCallback, useEffect, useState } from "react";

// Public, LAN-only kiosk board for a credential-less tablet. Renders
// under the bare root layout (no sidebar, no AuthProvider) and pulls
// presence data from the no-auth /api/board endpoint, so the browser
// never needs to sign in.

interface WhosInRow {
  employee_id: string;
  full_name: string;
  team: string;
  status: "in" | "out" | "never";
  first_tap_today: string | null;
  last_tap_today: string | null;
  tap_count_today: number;
}

interface BoardResponse {
  generated_at: string;
  counts: { in: number; out: number; never: number; total: number };
  rows: WhosInRow[];
}

const API_URL = "/employee-presence/api/board";
const REFRESH_MS = 30_000;

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function EmployeeCard({ row }: { row: WhosInRow }) {
  const isIn = row.status === "in";
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
        isIn
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-slate-700/60 bg-slate-800/40"
      }`}
    >
      <div className="min-w-0">
        <p
          className={`truncate text-lg font-semibold ${
            isIn ? "text-white" : "text-slate-300"
          }`}
        >
          {row.full_name}
        </p>
        <p className="text-sm text-slate-400">
          {row.status === "in" && row.first_tap_today
            ? `In since ${formatTime(row.first_tap_today)}`
            : row.status === "out" && row.last_tap_today
              ? `Out since ${formatTime(row.last_tap_today)}`
              : "No tap today"}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-lg px-3 py-1 text-sm font-bold uppercase tracking-wide ${
          isIn
            ? "bg-emerald-500 text-emerald-950"
            : "bg-slate-700 text-slate-300"
        }`}
      >
        {isIn ? "In" : "Out"}
      </span>
    </div>
  );
}

export default function BoardPage() {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BoardResponse;
      setData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      // Keep showing the last good board; just flag staleness.
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const inCount = data?.counts.in ?? 0;
  // "Out" on the board means "not currently on site" — folds together
  // people who tapped out and people who never tapped in today.
  const outCount = (data?.counts.out ?? 0) + (data?.counts.never ?? 0);

  // Group by team; within each team, currently-in first.
  const byTeam = (data?.rows ?? []).reduce<Record<string, WhosInRow[]>>(
    (acc, r) => {
      (acc[r.team || "—"] ??= []).push(r);
      return acc;
    },
    {}
  );
  for (const members of Object.values(byTeam)) {
    members.sort((a, b) => {
      if (a.status === "in" && b.status !== "in") return -1;
      if (b.status === "in" && a.status !== "in") return 1;
      return a.full_name.localeCompare(b.full_name);
    });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/employee-presence/pss-logo-reversed.png"
            alt="PSS"
            className="h-9 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight">Who&apos;s In</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-full bg-emerald-500/15 px-4 py-1.5 text-lg font-bold text-emerald-400">
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
            {inCount} in
          </span>
          <span className="flex items-center gap-2 rounded-full bg-slate-700/40 px-4 py-1.5 text-lg font-bold text-slate-300">
            <span className="h-3 w-3 rounded-full bg-slate-500" />
            {outCount} out
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 p-6">
        {data === null && !error && (
          <p className="pt-20 text-center text-slate-500">Loading…</p>
        )}

        {data !== null && data.rows.length === 0 && (
          <p className="pt-20 text-center text-slate-500">
            No active employees configured.
          </p>
        )}

        {Object.entries(byTeam).map(([team, members]) => (
          <section key={team}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">
              {team}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((row) => (
                <EmployeeCard key={row.employee_id} row={row} />
              ))}
            </div>
          </section>
        ))}
      </main>

      <footer className="px-6 pb-6 text-right text-xs text-slate-600">
        {error ? (
          <span className="text-amber-500">
            Connection issue — showing last update
            {lastRefresh
              ? ` from ${lastRefresh.toLocaleTimeString("en-GB", { timeZone: "Europe/London" })}`
              : ""}
          </span>
        ) : lastRefresh ? (
          <span>
            Updated{" "}
            {lastRefresh.toLocaleTimeString("en-GB", {
              timeZone: "Europe/London",
            })}{" "}
            · auto-refresh every 30s
          </span>
        ) : null}
      </footer>
    </div>
  );
}
