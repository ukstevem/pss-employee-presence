"use client";

import { useAuth, AuthButton } from "@platform/auth";
import { Spinner, EmptyState } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useCallback } from "react";

interface WhosInRow {
  employee_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  team: string;
  status: "in" | "out" | "never";
  first_tap_today: string | null;
  last_tap_today: string | null;
  tap_count_today: number;
}

const REFRESH_MS = 30_000;

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function StatusBadge({ status }: { status: WhosInRow["status"] }) {
  const styles = {
    in:    "bg-emerald-100 text-emerald-700 border-emerald-200",
    out:   "bg-gray-100 text-gray-600 border-gray-200",
    never: "bg-gray-50 text-gray-400 border-gray-100",
  }[status];
  const label = { in: "IN", out: "OUT", never: "—" }[status];
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-semibold uppercase tracking-wide rounded border ${styles}`}
    >
      {label}
    </span>
  );
}

function EmployeeCard({ row }: { row: WhosInRow }) {
  const dimmed = row.status === "never" ? "opacity-60" : "";
  return (
    <div
      className={`flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100 shadow-sm ${dimmed}`}
    >
      <div className="min-w-0">
        <p className="font-medium text-gray-800 truncate">{row.full_name}</p>
        <p className="text-xs text-gray-500">
          {row.status === "in" && row.first_tap_today && `In since ${formatTime(row.first_tap_today)}`}
          {row.status === "out" && row.last_tap_today && `Last out ${formatTime(row.last_tap_today)}`}
          {row.status === "never" && "Not tapped today"}
        </p>
      </div>
      <StatusBadge status={row.status} />
    </div>
  );
}

export default function WhosInPage() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<WhosInRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("employees_whos_in_now")
      .select("*")
      .order("team")
      .order("last_name");
    if (error) {
      setError(error.message);
      return;
    }
    setRows((data ?? []) as WhosInRow[]);
    setLastRefresh(new Date());
    setError(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [user, refresh]);

  if (authLoading) return null;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-gray-50">
        <h1 className="text-2xl font-semibold text-gray-800">Employee Presence</h1>
        <p className="text-gray-500">Sign in to continue</p>
        <AuthButton redirectTo="/employee-presence/" />
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Spinner />
      </div>
    );
  }

  const inCount = rows.filter((r) => r.status === "in").length;
  const outCount = rows.filter((r) => r.status === "out").length;
  const neverCount = rows.filter((r) => r.status === "never").length;

  const byTeam = rows.reduce<Record<string, WhosInRow[]>>((acc, r) => {
    (acc[r.team] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Who&apos;s In</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            {inCount} in
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
            {outCount} out
          </span>
          {neverCount > 0 && (
            <span className="flex items-center gap-1.5 text-gray-400">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />
              {neverCount} no tap
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm bg-red-50 text-red-700 border border-red-200 rounded">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState message="No active employees configured." />
      ) : (
        Object.entries(byTeam).map(([team, members]) => (
          <section key={team}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
              {team}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {members.map((row) => (
                <EmployeeCard key={row.employee_id} row={row} />
              ))}
            </div>
          </section>
        ))
      )}

      {lastRefresh && (
        <p className="text-xs text-gray-400 text-right">
          Updated {lastRefresh.toLocaleTimeString("en-GB", { timeZone: "Europe/London" })} · auto-refresh every 30s
        </p>
      )}
    </div>
  );
}
