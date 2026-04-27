"use client";

import { useAuth, AuthButton } from "@platform/auth";
import { Spinner, EmptyState } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { SHIFT_TIMEZONE } from "@/lib/shift";

type DailyHoursRow = {
  employee_id: string;
  full_name: string;
  team: string;
  pay_type: "hourly" | "salaried";
  work_date: string; // 'YYYY-MM-DD'
  is_working_day: boolean;
  scheduled_day_start: string;  // 'HH:MM:SS' from Postgres time type
  scheduled_day_finish: string;
  tap_count: number;
  first_tap: string | null;
  last_tap: string | null;
  first_tap_actor: string | null;
  last_tap_actor: string | null;
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

// Date helpers used for the range presets. All operate in the runtime's
// local timezone — not load-bearing for SQL correctness, since the
// function re-anchors to Europe/London at evaluation time.
function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day; // Mon = 1
  out.setDate(out.getDate() + offset);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfWeek(d: Date): Date {
  const out = startOfWeek(d);
  out.setDate(out.getDate() + 6);
  return out;
}

function shiftDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
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

function TapCell({
  actual,
  actor,
}: {
  actual: string | null;
  actor: string | null;
}) {
  if (!actual) return <span>—</span>;
  const isManual = actor === "admin";
  return (
    <span className="inline-flex items-center gap-1">
      <span>{formatTime(actual)}</span>
      {isManual && (
        <span
          title="Manually entered by an admin"
          className="text-[0.6rem] font-bold uppercase text-amber-700 bg-amber-100 border border-amber-200 rounded px-1 leading-none py-px"
        >
          M
        </span>
      )}
    </span>
  );
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [startDate, setStartDate] = useState(
    () =>
      searchParams.get("from") ?? isoDate(startOfWeek(new Date()))
  );
  const [endDate, setEndDate] = useState(
    () => searchParams.get("to") ?? isoDate(endOfWeek(new Date()))
  );
  const [teamFilter, setTeamFilter] = useState<string>(
    () => searchParams.get("team") ?? "all"
  );
  const [showWeekends, setShowWeekends] = useState(
    () => searchParams.get("weekends") === "1"
  );
  const [hideQuiet, setHideQuiet] = useState(
    () => searchParams.get("quiet") !== "0"
  );
  const [includeSalaried, setIncludeSalaried] = useState(
    () => searchParams.get("include_salaried") === "1"
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<DailyHoursRow | null>(null);
  const [rows, setRows] = useState<DailyHoursRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror state -> URL so refresh + share both work.
  useEffect(() => {
    const sp = new URLSearchParams();
    sp.set("from", startDate);
    sp.set("to", endDate);
    if (teamFilter !== "all") sp.set("team", teamFilter);
    if (showWeekends) sp.set("weekends", "1");
    if (!hideQuiet) sp.set("quiet", "0");
    if (includeSalaried) sp.set("include_salaried", "1");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [
    startDate,
    endDate,
    teamFilter,
    showWeekends,
    hideQuiet,
    includeSalaried,
    router,
    pathname,
  ]);

  function applyPreset(name: "this-week" | "last-week" | "this-month") {
    const today = new Date();
    if (name === "this-week") {
      setStartDate(isoDate(startOfWeek(today)));
      setEndDate(isoDate(endOfWeek(today)));
    } else if (name === "last-week") {
      const lastWeekRef = shiftDays(today, -7);
      setStartDate(isoDate(startOfWeek(lastWeekRef)));
      setEndDate(isoDate(endOfWeek(lastWeekRef)));
    } else {
      setStartDate(isoDate(startOfMonth(today)));
      setEndDate(isoDate(endOfMonth(today)));
    }
  }

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
      .filter((r) => includeSalaried || r.pay_type === "hourly")
      .sort((a, b) => {
        if (a.work_date !== b.work_date) {
          return a.work_date < b.work_date ? -1 : 1;
        }
        return a.full_name.localeCompare(b.full_name);
      });
  }, [rows, showWeekends, teamFilter, includeSalaried]);

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
      // Anomalies float to the top — that's the whole point of the
      // page when issues need addressing.
      const aAnoms = a.missed_in + a.missed_out + a.late_count;
      const bAnoms = b.missed_in + b.missed_out + b.late_count;
      if (aAnoms !== bAnoms) return bAnoms - aAnoms;
      // Then employees with any activity above quiet ones
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

      <div className="bg-white p-4 rounded-lg border border-gray-100 shadow-sm space-y-3">
        <div className="flex flex-wrap items-end gap-4">
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
          <div className="flex items-end gap-1 pb-0.5">
            <button
              type="button"
              onClick={() => applyPreset("this-week")}
              className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
            >
              This week
            </button>
            <button
              type="button"
              onClick={() => applyPreset("last-week")}
              className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
            >
              Last week
            </button>
            <button
              type="button"
              onClick={() => applyPreset("this-month")}
              className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
            >
              This month
            </button>
          </div>
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
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeSalaried}
              onChange={(e) => setIncludeSalaried(e.target.checked)}
            />
            Include salaried
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hideQuiet}
              onChange={(e) => setHideQuiet(e.target.checked)}
            />
            Hide employees with no taps
          </label>
          <label className="flex items-center gap-2">
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
                                <th className="text-left py-1 pr-3 font-medium">Flags</th>
                                <th className="text-right py-1 font-medium">Action</th>
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
                                      <TapCell actual={r.first_tap} actor={r.first_tap_actor} />
                                    </td>
                                    <td className="py-1 pr-3 text-gray-600">
                                      <TapCell actual={r.last_tap} actor={r.last_tap_actor} />
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
                                    <td className="py-1 text-right">
                                      {r.is_working_day && (
                                        <button
                                          onClick={() => setEditing(r)}
                                          className="px-2 py-0.5 text-[0.65rem] uppercase tracking-wide rounded border border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400"
                                        >
                                          Edit
                                        </button>
                                      )}
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

      {editing && (
        <EditDayModal
          day={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

type DayTap = {
  id: string;
  ts: string;
  actor: string | null;
  ignored: boolean;
  raw_payload: Record<string, unknown> | null;
};

function EditDayModal({
  day,
  onClose,
  onSaved,
}: {
  day: DailyHoursRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [taps, setTaps] = useState<DayTap[] | null>(null);
  // Set of tap_ids the manager has toggled (ignored if currently
  // un-ignored, and vice versa). We compare against original on save.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_day_taps", {
        p_employee_id: day.employee_id,
        p_work_date: day.work_date,
      });
      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else {
        setTaps((data ?? []) as DayTap[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [day.employee_id, day.work_date]);

  function toggleIgnore(tapId: string) {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(tapId)) next.delete(tapId);
      else next.add(tapId);
      return next;
    });
  }

  function isIgnoredAfter(t: DayTap): boolean {
    return toggled.has(t.id) ? !t.ignored : t.ignored;
  }

  function formatTapTime(ts: string): string {
    return new Date(ts).toLocaleTimeString("en-GB", {
      timeZone: SHIFT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function applyStandardHours() {
    setInTime(day.scheduled_day_start.slice(0, 5));
    setOutTime(day.scheduled_day_finish.slice(0, 5));
  }

  async function handleSave() {
    if (inTime && outTime && inTime >= outTime) {
      setError("Out time must be after in time");
      return;
    }
    const ignoreIds: string[] = [];
    const unignoreIds: string[] = [];
    for (const t of taps ?? []) {
      if (!toggled.has(t.id)) continue;
      if (t.ignored) unignoreIds.push(t.id);
      else ignoreIds.push(t.id);
    }
    if (
      ignoreIds.length === 0 &&
      unignoreIds.length === 0 &&
      !inTime &&
      !outTime
    ) {
      setError("Nothing to save");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("apply_day_corrections", {
      p_employee_id: day.employee_id,
      p_work_date: day.work_date,
      p_ignore_tap_ids: ignoreIds.length ? ignoreIds : null,
      p_unignore_tap_ids: unignoreIds.length ? unignoreIds : null,
      p_in_time: inTime || null,
      p_out_time: outTime || null,
      p_reason: reason.trim() || null,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Edit taps</h3>
          <p className="text-sm text-gray-600 mt-1">
            {day.full_name} — {formatDateLabel(day.work_date)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Schedule: {day.scheduled_day_start.slice(0, 5)} – {day.scheduled_day_finish.slice(0, 5)}
          </p>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-gray-500 block mb-2">
            Existing taps
          </label>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (taps ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              No taps recorded for this day.
            </p>
          ) : (
            <ul className="space-y-1 border border-gray-100 rounded">
              {(taps ?? []).map((t) => {
                const ignoredNow = isIgnoredAfter(t);
                const isAdmin = t.actor === "admin";
                return (
                  <li
                    key={t.id}
                    className={`flex items-center gap-3 px-3 py-2 text-sm border-b last:border-b-0 border-gray-50 ${
                      ignoredNow ? "bg-gray-50 text-gray-400 line-through" : "bg-white text-gray-800"
                    }`}
                  >
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ignoredNow}
                        onChange={() => toggleIgnore(t.id)}
                      />
                      <span className="text-[0.65rem] uppercase tracking-wide text-gray-500 select-none">
                        Ignore
                      </span>
                    </label>
                    <span className="font-mono w-14">{formatTapTime(t.ts)}</span>
                    {isAdmin && (
                      <span
                        title="Manually entered by an admin"
                        className="text-[0.55rem] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded px-1 leading-none py-px"
                      >
                        M
                      </span>
                    )}
                    {t.actor && t.actor !== "admin" && (
                      <span className="text-[0.55rem] uppercase tracking-wide text-gray-400">
                        {t.actor}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-baseline justify-between mb-2">
            <label className="text-xs uppercase tracking-wide text-gray-500">
              Add a new pair (optional)
            </label>
            <button
              type="button"
              onClick={applyStandardHours}
              className="text-[0.65rem] uppercase tracking-wide text-blue-600 hover:underline"
            >
              Apply standard hours
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[0.65rem] uppercase text-gray-500 block">
                In
              </label>
              <input
                type="time"
                value={inTime}
                onChange={(e) => setInTime(e.target.value)}
                className="w-full mt-1 border rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[0.65rem] uppercase text-gray-500 block">
                Out
              </label>
              <input
                type="time"
                value={outTime}
                onChange={(e) => setOutTime(e.target.value)}
                className="w-full mt-1 border rounded px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-gray-500">
            Reason (optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Tapped wrong reader, real start was 06:00"
            className="w-full mt-1 border rounded px-3 py-1.5 text-sm"
          />
        </div>

        {error && (
          <div className="p-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded border hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
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
