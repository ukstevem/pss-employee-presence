"use client";

import { useAuth, AuthButton } from "@platform/auth";
import { Spinner, EmptyState } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useCallback, Fragment } from "react";

type ShiftPattern = {
  id: string;
  name: string;
  description: string | null;
  timezone: string;
  paid_lunch: boolean;
  active: boolean;
};

type ShiftPatternDay = {
  id: string;
  shift_pattern_id: string;
  weekday: number;
  day_start: string; // "HH:MM:SS" from Postgres
  day_finish: string;
  lunch_start: string | null;
  lunch_finish: string | null;
};

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  team: string;
  shift_pattern_id: string | null;
};

type DayEdit = {
  enabled: boolean;
  day_start: string;
  day_finish: string;
  lunch_start: string;
  lunch_finish: string;
};

type EditForm = {
  name: string;
  description: string;
  paid_lunch: boolean;
  active: boolean;
  days: Record<number, DayEdit>;
};

const WEEKDAYS: { num: number; label: string }[] = [
  { num: 1, label: "Mon" },
  { num: 2, label: "Tue" },
  { num: 3, label: "Wed" },
  { num: 4, label: "Thu" },
  { num: 5, label: "Fri" },
  { num: 6, label: "Sat" },
  { num: 7, label: "Sun" },
];

function trimTime(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

function emptyDayEdit(): DayEdit {
  return {
    enabled: false,
    day_start: "08:00",
    day_finish: "17:00",
    lunch_start: "",
    lunch_finish: "",
  };
}

function makeNewForm(): EditForm {
  const weekday: DayEdit = {
    enabled: true,
    day_start: "08:00",
    day_finish: "17:00",
    lunch_start: "12:00",
    lunch_finish: "12:30",
  };
  return {
    name: "",
    description: "",
    paid_lunch: false,
    active: true,
    days: {
      1: { ...weekday },
      2: { ...weekday },
      3: { ...weekday },
      4: { ...weekday },
      5: { ...weekday },
      6: emptyDayEdit(),
      7: emptyDayEdit(),
    },
  };
}

function formFromPattern(p: ShiftPattern, days: ShiftPatternDay[]): EditForm {
  const map: Record<number, DayEdit> = {};
  for (const { num } of WEEKDAYS) {
    const d = days.find((x) => x.weekday === num);
    map[num] = d
      ? {
          enabled: true,
          day_start: trimTime(d.day_start),
          day_finish: trimTime(d.day_finish),
          lunch_start: trimTime(d.lunch_start),
          lunch_finish: trimTime(d.lunch_finish),
        }
      : emptyDayEdit();
  }
  return {
    name: p.name,
    description: p.description ?? "",
    paid_lunch: p.paid_lunch,
    active: p.active,
    days: map,
  };
}

function describeDays(days: ShiftPatternDay[]): string {
  if (days.length === 0) return "no days configured";
  const sorted = [...days].sort((a, b) => a.weekday - b.weekday);
  return sorted
    .map(
      (d) =>
        `${WEEKDAYS[d.weekday - 1].label} ${trimTime(d.day_start)}–${trimTime(d.day_finish)}`
    )
    .join(", ");
}

export default function ShiftAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [days, setDays] = useState<ShiftPatternDay[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    const [pRes, dRes, eRes] = await Promise.all([
      supabase.from("employee_shift_pattern").select("*").order("name"),
      supabase.from("employee_shift_pattern_day").select("*"),
      supabase
        .from("employees")
        .select("id, first_name, last_name, team, shift_pattern_id")
        .eq("active", true)
        .order("last_name"),
    ]);
    const firstErr = pRes.error || dRes.error || eRes.error;
    if (firstErr) {
      setError(firstErr.message);
      setLoading(false);
      return;
    }
    setPatterns((pRes.data ?? []) as ShiftPattern[]);
    setDays((dRes.data ?? []) as ShiftPatternDay[]);
    setEmployees((eRes.data ?? []) as Employee[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  function startEdit(p: ShiftPattern) {
    setEditingId(p.id);
    setEditForm(
      formFromPattern(
        p,
        days.filter((d) => d.shift_pattern_id === p.id)
      )
    );
  }
  function startNew() {
    setEditingId("new");
    setEditForm(makeNewForm());
  }
  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function handleSave() {
    if (!editForm || !editingId) return;
    setSaving(true);
    setError(null);

    let patternId = editingId;
    if (editingId === "new") {
      const { data, error } = await supabase
        .from("employee_shift_pattern")
        .insert({
          name: editForm.name,
          description: editForm.description || null,
          paid_lunch: editForm.paid_lunch,
          active: editForm.active,
        })
        .select("id")
        .single();
      if (error || !data) {
        setError(error?.message ?? "Insert failed");
        setSaving(false);
        return;
      }
      patternId = data.id as string;
    } else {
      const { error } = await supabase
        .from("employee_shift_pattern")
        .update({
          name: editForm.name,
          description: editForm.description || null,
          paid_lunch: editForm.paid_lunch,
          active: editForm.active,
        })
        .eq("id", editingId);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    }

    // Reconcile day rows
    for (const { num } of WEEKDAYS) {
      const d = editForm.days[num];
      const existing = days.find(
        (x) => x.shift_pattern_id === patternId && x.weekday === num
      );
      if (d.enabled) {
        const row = {
          shift_pattern_id: patternId,
          weekday: num,
          day_start: d.day_start,
          day_finish: d.day_finish,
          lunch_start: d.lunch_start || null,
          lunch_finish: d.lunch_finish || null,
        };
        const { error } = existing
          ? await supabase
              .from("employee_shift_pattern_day")
              .update(row)
              .eq("id", existing.id)
          : await supabase.from("employee_shift_pattern_day").insert(row);
        if (error) {
          setError(`Day ${num}: ${error.message}`);
          setSaving(false);
          return;
        }
      } else if (existing) {
        const { error } = await supabase
          .from("employee_shift_pattern_day")
          .delete()
          .eq("id", existing.id);
        if (error) {
          setError(`Delete day ${num}: ${error.message}`);
          setSaving(false);
          return;
        }
      }
    }

    setEditingId(null);
    setEditForm(null);
    setSaving(false);
    await refresh();
  }

  async function handleDelete(id: string, name: string) {
    if (
      !window.confirm(
        `Delete shift pattern "${name}"?\n\nAny employees assigned to it will have their shift_pattern_id set to NULL (falling back to the global default).`
      )
    )
      return;
    const { error } = await supabase
      .from("employee_shift_pattern")
      .delete()
      .eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingId(null);
    setEditForm(null);
    await refresh();
  }

  async function handleAssign(employeeId: string, patternId: string | null) {
    const { error } = await supabase
      .from("employees")
      .update({ shift_pattern_id: patternId })
      .eq("id", employeeId);
    if (error) {
      setError(error.message);
      return;
    }
    await refresh();
  }

  if (authLoading) return null;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-gray-50">
        <h1 className="text-2xl font-semibold text-gray-800">Shift Patterns</h1>
        <p className="text-gray-500">Sign in to continue</p>
        <AuthButton redirectTo="/employee-presence/admin/shifts/" />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Spinner />
      </div>
    );
  }

  const activePatterns = patterns.filter((p) => p.active);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold text-gray-800">Shift Patterns</h1>

      {error && (
        <div className="p-3 text-sm bg-red-50 text-red-700 border border-red-200 rounded">
          {error}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Patterns ({patterns.length})
          </h2>
          {editingId === null && (
            <button
              onClick={startNew}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700"
            >
              + New pattern
            </button>
          )}
        </div>

        <div className="space-y-2">
          {editingId === "new" && editForm && (
            <PatternEditor
              form={editForm}
              setForm={setEditForm}
              onSave={handleSave}
              onCancel={cancelEdit}
              saving={saving}
            />
          )}

          {patterns.length === 0 && editingId !== "new" ? (
            <EmptyState message="No shift patterns yet. Create one to start assigning employees." />
          ) : (
            patterns.map((p) => (
              <Fragment key={p.id}>
                {editingId === p.id && editForm ? (
                  <PatternEditor
                    form={editForm}
                    setForm={setEditForm}
                    onSave={handleSave}
                    onCancel={cancelEdit}
                    onDelete={() => handleDelete(p.id, p.name)}
                    saving={saving}
                  />
                ) : (
                  <PatternRow
                    pattern={p}
                    days={days.filter((d) => d.shift_pattern_id === p.id)}
                    onClick={() => startEdit(p)}
                  />
                )}
              </Fragment>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
          Employee assignments ({employees.length})
        </h2>
        <p className="text-xs text-gray-500 mb-2">
          Employees with no pattern fall back to the global default
          (Mon–Fri 08:00–17:00, no lunch deduction).
        </p>
        {employees.length === 0 ? (
          <EmptyState message="No active employees." />
        ) : (
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">Employee</th>
                  <th className="text-left py-2 px-3 font-medium">Team</th>
                  <th className="text-left py-2 px-3 font-medium">Shift pattern</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 px-3 font-medium text-gray-800">
                      {e.last_name}, {e.first_name}
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-xs uppercase">
                      {e.team}
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={e.shift_pattern_id ?? ""}
                        onChange={(ev) =>
                          handleAssign(e.id, ev.target.value || null)
                        }
                        className="border rounded px-2 py-1 text-sm bg-white"
                      >
                        <option value="">(none — use defaults)</option>
                        {activePatterns.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PatternRow({
  pattern,
  days,
  onClick,
}: {
  pattern: ShiftPattern;
  days: ShiftPatternDay[];
  onClick: () => void;
}) {
  const inactiveTone = !pattern.active ? "opacity-60" : "";
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg border border-gray-100 shadow-sm p-3 cursor-pointer hover:bg-blue-50/40 ${inactiveTone}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-gray-800">
          {pattern.name}
          {!pattern.active && (
            <span className="ml-2 text-xs uppercase text-gray-400">
              inactive
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {pattern.paid_lunch ? "Paid lunch" : "Unpaid lunch"}
        </div>
      </div>
      {pattern.description && (
        <p className="text-sm text-gray-500 mt-1">{pattern.description}</p>
      )}
      <p className="text-xs text-gray-500 mt-1 font-mono">
        {describeDays(days)}
      </p>
    </div>
  );
}

function PatternEditor({
  form,
  setForm,
  onSave,
  onCancel,
  onDelete,
  saving,
}: {
  form: EditForm;
  setForm: (f: EditForm) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const setDay = (num: number, patch: Partial<DayEdit>) =>
    setForm({
      ...form,
      days: { ...form.days, [num]: { ...form.days[num], ...patch } },
    });

  return (
    <div className="bg-white rounded-lg border-2 border-blue-300 shadow-sm p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col text-xs text-gray-500">
          Name
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 border rounded px-2 py-1.5 text-sm"
            placeholder="e.g. Standard 08–17"
          />
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          Description
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 border rounded px-2 py-1.5 text-sm"
            placeholder="optional"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.paid_lunch}
            onChange={(e) =>
              setForm({ ...form, paid_lunch: e.target.checked })
            }
          />
          Paid lunch (lunch window not subtracted from worked time)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active (selectable for assignment)
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left py-1.5 px-2 font-medium">Day</th>
              <th className="text-center py-1.5 px-2 font-medium">On?</th>
              <th className="text-left py-1.5 px-2 font-medium">Start</th>
              <th className="text-left py-1.5 px-2 font-medium">End</th>
              <th className="text-left py-1.5 px-2 font-medium">Lunch start</th>
              <th className="text-left py-1.5 px-2 font-medium">Lunch end</th>
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map(({ num, label }) => {
              const d = form.days[num];
              return (
                <tr key={num} className={!d.enabled ? "opacity-40" : ""}>
                  <td className="py-1.5 px-2 font-medium">{label}</td>
                  <td className="py-1.5 px-2 text-center">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) =>
                        setDay(num, { enabled: e.target.checked })
                      }
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="time"
                      value={d.day_start}
                      disabled={!d.enabled}
                      onChange={(e) => setDay(num, { day_start: e.target.value })}
                      className="border rounded px-2 py-1 text-sm w-28"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="time"
                      value={d.day_finish}
                      disabled={!d.enabled}
                      onChange={(e) =>
                        setDay(num, { day_finish: e.target.value })
                      }
                      className="border rounded px-2 py-1 text-sm w-28"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="time"
                      value={d.lunch_start}
                      disabled={!d.enabled}
                      onChange={(e) =>
                        setDay(num, { lunch_start: e.target.value })
                      }
                      className="border rounded px-2 py-1 text-sm w-28"
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <input
                      type="time"
                      value={d.lunch_finish}
                      disabled={!d.enabled}
                      onChange={(e) =>
                        setDay(num, { lunch_finish: e.target.value })
                      }
                      className="border rounded px-2 py-1 text-sm w-28"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">
          Leave both lunch fields blank for no lunch deduction. Days with the
          On box unchecked are days off — employees on this pattern won&apos;t
          have hours expected.
        </p>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <button
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          className="px-4 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-1.5 text-sm rounded border hover:bg-gray-50"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="ml-auto px-4 py-1.5 text-sm rounded border border-red-200 text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
