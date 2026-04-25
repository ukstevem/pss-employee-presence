"use client";

import { useAuth, AuthButton } from "@platform/auth";
import { Spinner, EmptyState } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { SHIFT_TIMEZONE } from "@/lib/shift";

type DailyHoursRow = {
  employee_id: string;
  full_name: string;
  team: string;
  work_date: string; // 'YYYY-MM-DD'
  is_working_day: boolean;
  tap_count: number;
  first_tap: string | null;
  last_tap: string | null;
  worked_minutes: number;
  missed_clock_in: boolean;
  missed_clock_out: boolean;
  late_minutes: number | null;
  early_finish_minutes: number | null;
};

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Monday of the week containing `d`, in runtime-local TZ. Used for the
// date-range default; not load-bearing for SQL correctness (the function
// re-anchors to Europe/London).
function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day; // Mon = 1
  out.setDate(out.getDate() + offset);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", {
    timeZone: SHIFT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateLabel(isoYmd: string): string {
  // 'YYYY-MM-DD' → 'Mon 21 Apr'
  const d = new Date(`${isoYmd}T00:00:00`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function Badge({
  label,
  tone,
  title,
}: {
  label: string;
  tone: "amber" | "red" | "blue" | "gray";
  title?: string;
}) {
  const styles = {
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    red: "bg-red-100 text-red-700 border-red-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
  }[tone];
  return (
    <span
      title={title}
      className={`inline-block px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide rounded border ${styles}`}
    >
      {label}
    </span>
  );
}

export default function HoursPage() {
  const { user, loading: authLoading } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(isoDate(startOfWeek(today)));
  const [endDate, setEndDate] = useState(isoDate(today));
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [showWeekends, setShowWeekends] = useState(false);
  const [hideQuiet, setHideQuiet] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<DailyHoursRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("employees_daily_hours", {
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as DailyHoursRow[]);
    }
    setLoading(false);
  }, [user, startDate, endDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((r) => showWeekends || r.is_working_day)
      .filter((r) => teamFilter === "all" || r.team === teamFilter)
      .sort((a, b) => {
        if (a.work_date !== b.work_date) {
          return a.work_date < b.work_date ? -1 : 1;
        }
        return a.full_name.localeCompare(b.full_name);
      });
  }, [rows, showWeekends, teamFilter]);

  const teams = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map((r) => r.team))].sort();
  }, [rows]);

  const summary = useMemo(() => {
    let totalMinutes = 0;
    let missedIn = 0;
    let missedOut = 0;
    let late = 0;
    for (const r of visibleRows) {
      totalMinutes += r.worked_minutes;
      if (r.is_working_day && r.missed_clock_in) missedIn += 1;
      if (r.missed_clock_out) missedOut += 1;
      if (r.late_minutes !== null && r.late_minutes > 0) late += 1;
    }
    return { totalMinutes, missedIn, missedOut, late };
  }, [visibleRows]);

  type EmployeeSummary = {
    employee_id: string;
    full_name: string;
    team: string;
    days_worked: number;
    total_minutes: number;
    missed_in: number;
    missed_out: number;
    late_count: number;
    days: DailyHoursRow[];
  };

  const employeeSummaries = useMemo<EmployeeSummary[]>(() => {
    const map = new Map<string, EmployeeSummary>();
    for (const r of visibleRows) {
      let s = map.get(r.employee_id);
      if (!s) {
        s = {
          employee_id: r.employee_id,
          full_name: r.full_name,
          team: r.team,
          days_worked: 0,
          total_minutes: 0,
          missed_in: 0,
          missed_out: 0,
          late_count: 0,
          days: [],
        };
        map.set(r.employee_id, s);
      }
      s.days.push(r);
      if (r.tap_count > 0) s.days_worked += 1;
      s.total_minutes += r.worked_minutes;
      if (r.is_working_day && r.missed_clock_in) s.missed_in += 1;
      if (r.missed_clock_out) s.missed_out += 1;
      if (r.late_minutes !== null && r.late_minutes > 0) s.late_count += 1;
    }
    return [...map.values()].sort((a, b) => {
      // Employees with activity float to the top
      const aActive = a.total_minutes > 0 || a.days_worked > 0 ? 1 : 0;
      const bActive = b.total_minutes > 0 || b.days_worked > 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [visibleRows]);

  const visibleSummaries = useMemo(() => {
    if (!hideQuiet) return employeeSummaries;
    return employeeSummaries.filter(
      (s) => s.days_worked > 0 || s.missed_out > 0
    );
  }, [employeeSummaries, hideQuiet]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (authLoading) return null;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-gray-50">
        <h1 className="text-2xl font-semibold text-gray-800">Hours Analysis</h1>
        <p className="text-gray-500">Sign in to continue</p>
        <AuthButton redirectTo="/employee-presence/hours/" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold text-gray-800">Hours Analysis</h1>

      <div className="flex flex-wrap items-end gap-4 bg-white p-4 rounded-lg border border-gray-100 shadow-sm">
        <label className="flex flex-col text-xs text-gray-500">
          From
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          To
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          Team
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="mt-1 border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-4 ml-auto">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={hideQuiet}
              onChange={(e) => setHideQuiet(e.target.checked)}
            />
            Hide employees with no taps
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showWeekends}
              onChange={(e) => setShowWeekends(e.target.checked)}
            />
            Show weekends
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm bg-red-50 text-red-700 border border-red-200 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Total hours" value={formatHours(summary.totalMinutes)} />
        <SummaryTile label="Missed clock-in" value={String(summary.missedIn)} tone={summary.missedIn > 0 ? "amber" : "default"} />
        <SummaryTile label="Missed clock-out" value={String(summary.missedOut)} tone={summary.missedOut > 0 ? "red" : "default"} />
        <SummaryTile label="Late arrivals" value={String(summary.late)} tone={summary.late > 0 ? "amber" : "default"} />
      </div>

      {loading ? (
        <div className="p-6 flex items-center justify-center min-h-[40vh]">
          <Spinner />
        </div>
      ) : visibleSummaries.length === 0 ? (
        <EmptyState
          message={
            hideQuiet
              ? "No employees with taps in this range. Untick \"Hide employees with no taps\" to see the full roster."
              : "No data for this range."
          }
        />
      ) : (
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-8" />
                <th className="text-left py-2 px-3 font-medium">Employee</th>
                <th className="text-left py-2 px-3 font-medium">Team</th>
                <th className="text-right py-2 px-3 font-medium">Days</th>
                <th className="text-right py-2 px-3 font-medium">Hours</th>
                <th className="text-left py-2 px-3 font-medium">Anomalies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleSummaries.map((s) => {
                const isExpanded = expanded.has(s.employee_id);
                const isQuiet = s.days_worked === 0 && s.missed_out === 0;
                return (
                  <Fragment key={s.employee_id}>
                    <tr
                      onClick={() => toggleExpanded(s.employee_id)}
                      className={`cursor-pointer hover:bg-blue-50/40 ${isQuiet ? "opacity-60" : ""}`}
                    >
                      <td className="py-2 px-2 text-gray-400 text-center select-none">
                        {isExpanded ? "▾" : "▸"}
                      </td>
                      <td className="py-2 px-3 font-medium text-gray-800">{s.full_name}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs uppercase">{s.team}</td>
                      <td className="py-2 px-3 text-right text-gray-600">{s.days_worked}</td>
                      <td className="py-2 px-3 text-right text-gray-700">
                        {formatHours(s.total_minutes)}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {s.missed_in > 0 && (
                            <Badge
                              label={`${s.missed_in} no in`}
                              tone="amber"
                              title="Working days with no taps recorded"
                            />
                          )}
                          {s.missed_out > 0 && (
                            <Badge
                              label={`${s.missed_out} no out`}
                              tone="red"
                              title="Days with an odd tap count (last tap unpaired)"
                            />
                          )}
                          {s.late_count > 0 && (
                            <Badge
                              label={`${s.late_count} late`}
                              tone="amber"
                              title="Days with first tap after shift start"
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-50/60">
                        <td />
                        <td colSpan={5} className="py-2 px-3">
                          <table className="w-full text-xs">
                            <thead className="text-[0.65rem] uppercase tracking-wide text-gray-500">
                              <tr>
                                <th className="text-left py-1 pr-3 font-medium">Date</th>
                                <th className="text-right py-1 pr-3 font-medium">Taps</th>
                                <th className="text-left py-1 pr-3 font-medium">First</th>
                                <th className="text-left py-1 pr-3 font-medium">Last</th>
                                <th className="text-right py-1 pr-3 font-medium">Hours</th>
                                <th className="text-left py-1 font-medium">Flags</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.days.map((r) => {
                                const dim = !r.is_working_day ? "opacity-60" : "";
                                return (
                                  <tr key={`${s.employee_id}-${r.work_date}`} className={dim}>
                                    <td className="py-1 pr-3 text-gray-600 whitespace-nowrap">
                                      {formatDateLabel(r.work_date)}
                                    </td>
                                    <td className="py-1 pr-3 text-right text-gray-600">
                                      {r.tap_count}
                                    </td>
                                    <td className="py-1 pr-3 text-gray-600">
                                      {formatTime(r.first_tap)}
                                    </td>
                                    <td className="py-1 pr-3 text-gray-600">
                                      {formatTime(r.last_tap)}
                                    </td>
                                    <td className="py-1 pr-3 text-right text-gray-700">
                                      {formatHours(r.worked_minutes)}
                                    </td>
                                    <td className="py-1">
                                      <div className="flex flex-wrap gap-1">
                                        {!r.is_working_day && <Badge label="Off" tone="gray" />}
                                        {r.is_working_day && r.missed_clock_in && (
                                          <Badge label="No in" tone="amber" />
                                        )}
                                        {r.missed_clock_out && (
                                          <Badge label="No out" tone="red" />
                                        )}
                                        {r.late_minutes !== null && r.late_minutes > 0 && (
                                          <Badge label={`Late ${r.late_minutes}m`} tone="amber" />
                                        )}
                                        {r.early_finish_minutes !== null &&
                                          r.early_finish_minutes > 0 && (
                                            <Badge
                                              label={`Early ${r.early_finish_minutes}m`}
                                              tone="blue"
                                            />
                                          )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "amber" | "red";
}) {
  const valueColor = {
    default: "text-gray-800",
    amber: "text-amber-700",
    red: "text-red-700",
  }[tone];
  return (
    <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${valueColor}`}>{value}</p>
    </div>
  );
}
