"use client";

import { useAuth, AuthButton } from "@platform/auth";
import { Spinner } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useCallback } from "react";

type WhosInRow = {
  employee_id: string;
  full_name: string;
  team: string;
  status: "in" | "out" | "never";
  first_tap_today: string | null;
  last_tap_today: string | null;
};

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RollCallPage() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<WhosInRow[] | null>(null);
  const [accounted, setAccounted] = useState<Set<string>>(new Set());
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  // Deliberately NO auto-refresh: once a roll call starts, the marshal
  // wants a stable snapshot of "who was IN at evacuation time". A
  // refresh button is provided for re-snapshotting before the next
  // incident.
  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("employees_whos_in_now")
      .select(
        "employee_id, full_name, team, status, first_tap_today, last_tap_today"
      )
      .order("team")
      .order("last_name");
    setRows((data ?? []) as WhosInRow[]);
    setAccounted(new Set());
    setSnapshotAt(new Date());
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleAccounted = (id: string) => {
    setAccounted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (authLoading) return null;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-gray-50">
        <h1 className="text-2xl font-semibold text-gray-800">Roll Call</h1>
        <p className="text-gray-500">Sign in to continue</p>
        <AuthButton redirectTo="/employee-presence/roll-call/" />
      </div>
    );
  }
  if (rows === null || loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Spinner />
      </div>
    );
  }

  const expected = rows.filter((r) => r.status === "in");
  const notIn = rows.filter((r) => r.status !== "in");
  const accountedCount = expected.filter((r) =>
    accounted.has(r.employee_id)
  ).length;
  const outstanding = expected.length - accountedCount;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto bg-white min-h-screen print:p-0 print:max-w-none print:bg-white">
      <div className="flex items-baseline justify-between mb-4 print:mb-2">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">
          Roll Call
        </h1>
        <button
          onClick={() => void refresh()}
          className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 print:hidden"
        >
          New snapshot
        </button>
      </div>

      <div className="text-sm text-gray-500 mb-6 print:mb-3">
        Snapshot taken{" "}
        <strong>
          {snapshotAt?.toLocaleString("en-GB", {
            timeZone: "Europe/London",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </strong>
        . Tap an entry to mark as accounted for.
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6 text-center print:mb-3">
        <Tile label="Expected" value={String(expected.length)} tone="default" />
        <Tile
          label="Accounted for"
          value={String(accountedCount)}
          tone="emerald"
        />
        <Tile
          label="Outstanding"
          value={String(outstanding)}
          tone={outstanding > 0 ? "red" : "default"}
        />
      </div>

      <h2 className="text-xl font-bold uppercase tracking-wide text-emerald-700 border-b-2 border-emerald-200 pb-1 mb-3 print:text-lg">
        Expected on site ({expected.length})
      </h2>
      {expected.length === 0 ? (
        <p className="text-gray-500 italic mb-8">
          Nobody is currently clocked in.
        </p>
      ) : (
        <ul className="space-y-2 mb-8 print:mb-4 print:space-y-0">
          {expected.map((r) => {
            const ticked = accounted.has(r.employee_id);
            return (
              <li
                key={r.employee_id}
                onClick={() => toggleAccounted(r.employee_id)}
                className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer border-2 transition-colors print:p-2 print:rounded-none print:border-gray-300 ${
                  ticked
                    ? "bg-emerald-50 border-emerald-300 text-gray-500 line-through"
                    : "bg-white border-gray-200 hover:bg-blue-50/50"
                }`}
              >
                <span
                  className={`w-10 h-10 shrink-0 rounded border-2 flex items-center justify-center text-2xl print:w-6 print:h-6 print:text-base ${
                    ticked
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-gray-300"
                  }`}
                >
                  {ticked ? "✓" : ""}
                </span>
                <span className="flex-1 text-xl font-medium print:text-base">
                  {r.full_name}
                </span>
                <span className="text-xs uppercase text-gray-500 hidden sm:inline">
                  {r.team}
                </span>
                <span className="text-sm text-gray-500 hidden md:inline print:hidden">
                  In since {formatTime(r.first_tap_today)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {notIn.length > 0 && (
        <div className="print:hidden">
          <h2 className="text-lg font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 pb-1 mb-2">
            Not in today ({notIn.length})
          </h2>
          <p className="text-xs text-gray-400 mb-2">
            Reference only — these people are not expected at the muster point.
            If you see them, flag them outside the system.
          </p>
          <ul className="text-sm text-gray-500 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            {notIn.map((r) => (
              <li
                key={r.employee_id}
                className="flex justify-between py-1 border-b border-gray-50"
              >
                <span>{r.full_name}</span>
                <span className="text-xs uppercase">{r.team}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "emerald" | "red";
}) {
  const valueColor = {
    default: "text-gray-800",
    emerald: "text-emerald-600",
    red: "text-red-600",
  }[tone];
  return (
    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm print:border-gray-300 print:shadow-none">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${valueColor}`}>{value}</p>
    </div>
  );
}
