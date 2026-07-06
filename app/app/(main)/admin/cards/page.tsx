"use client";

import { useAuth, AuthButton } from "@platform/auth";
import { Spinner, EmptyState } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useCallback } from "react";

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
};

type EmployeeCardRow = {
  id: string;
  card_id: string;
  employee_id: string;
  active: boolean;
  notes: string | null;
  created_at: string;
  deactivated_at: string | null;
  employee: Employee | null;
};

type UnmappedCard = {
  card_id: string;
  tap_count: number;
  last_seen: string;
  device_id: string;
};

type SuspiciousTap = {
  card_id: string;
  last_holder: string | null;
  tap_count: number;
  last_seen: string;
  device_id: string;
};

function formatDateTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function employeeLabel(e: Employee): string {
  return `${e.last_name}, ${e.first_name}`;
}

export default function CardsAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activeCards, setActiveCards] = useState<EmployeeCardRow[]>([]);
  const [deactivatedCards, setDeactivatedCards] = useState<EmployeeCardRow[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedCard[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousTap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerByCard, setPickerByCard] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setError(null);

    const [empRes, cardsRes, eventsRes] = await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name")
        .eq("active", true)
        .order("last_name"),
      supabase
        .from("employee_cards")
        .select("*, employee:employees(id, first_name, last_name)")
        .order("created_at", { ascending: false }),
      supabase
        .from("timecard_events_90d")
        .select("card_id, ts, device_id")
        .order("ts", { ascending: false }),
    ]);

    const firstError = empRes.error || cardsRes.error || eventsRes.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setEmployees((empRes.data ?? []) as Employee[]);
    const allCards = (cardsRes.data ?? []) as EmployeeCardRow[];
    setActiveCards(allCards.filter((c) => c.active));
    setDeactivatedCards(allCards.filter((c) => !c.active));

    // "mapped" = card_id has any row (active or deactivated). Deactivated
    // cards must NOT appear as unassigned — they're permanently retired.
    const mappedIds = new Set(allCards.map((c) => c.card_id));
    const deactivatedById = new Map(
      allCards.filter((c) => !c.active).map((c) => [c.card_id, c])
    );
    const unmappedAcc = new Map<string, UnmappedCard>();
    const suspiciousAcc = new Map<string, SuspiciousTap>();
    for (const row of (eventsRes.data ?? []) as {
      card_id: string;
      ts: string;
      device_id: string;
    }[]) {
      const deactivated = deactivatedById.get(row.card_id);
      if (deactivated) {
        const existing = suspiciousAcc.get(row.card_id);
        if (!existing) {
          suspiciousAcc.set(row.card_id, {
            card_id: row.card_id,
            last_holder: deactivated.employee
              ? employeeLabel(deactivated.employee)
              : null,
            tap_count: 1,
            last_seen: row.ts,
            device_id: row.device_id,
          });
        } else {
          existing.tap_count += 1;
        }
        continue;
      }
      if (mappedIds.has(row.card_id)) continue;
      const existing = unmappedAcc.get(row.card_id);
      if (!existing) {
        unmappedAcc.set(row.card_id, {
          card_id: row.card_id,
          tap_count: 1,
          last_seen: row.ts,
          device_id: row.device_id,
        });
      } else {
        existing.tap_count += 1;
      }
    }
    setUnmapped(
      [...unmappedAcc.values()].sort((a, b) =>
        a.last_seen < b.last_seen ? 1 : -1
      )
    );
    setSuspicious(
      [...suspiciousAcc.values()].sort((a, b) =>
        a.last_seen < b.last_seen ? 1 : -1
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  async function assign(card_id: string, employee_id: string) {
    if (!employee_id) return;
    const { error } = await supabase
      .from("employee_cards")
      .insert({ card_id, employee_id, active: true });
    if (error) {
      setError(error.message);
      return;
    }
    setPickerByCard((p) => ({ ...p, [card_id]: "" }));
    await refresh();
  }

  async function deactivate(row: EmployeeCardRow) {
    const reason = window.prompt(
      `Deactivate card ${row.card_id} (${row.employee ? employeeLabel(row.employee) : "?"})?\n\nOptional note:`,
      ""
    );
    if (reason === null) return; // Cancelled
    const { error } = await supabase
      .from("employee_cards")
      .update({
        active: false,
        deactivated_at: new Date().toISOString(),
        notes: reason
          ? row.notes
            ? `${row.notes}\n${reason}`
            : reason
          : row.notes,
      })
      .eq("id", row.id);
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
        <h1 className="text-2xl font-semibold text-gray-800">Employee Cards</h1>
        <p className="text-gray-500">Sign in to continue</p>
        <AuthButton redirectTo="/employee-presence/admin/cards/" />
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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold text-gray-800">Employee Cards</h1>

      {error && (
        <div className="p-3 text-sm bg-red-50 text-red-700 border border-red-200 rounded">
          {error}
        </div>
      )}

      {suspicious.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700 mb-1">
            Recent taps on deactivated cards ({suspicious.length})
          </h2>
          <p className="text-xs text-red-700/80 mb-3">
            These card UIDs are deactivated but have been tapped in the last 90
            days. The reader silently ignored them. Investigate — the holder may
            be using a card they thought was still active, or a lost card has
            been recovered.
          </p>
          <div className="bg-white rounded border border-red-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-red-100/40 text-xs uppercase tracking-wide text-red-700">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">Card ID</th>
                  <th className="text-left py-2 px-3 font-medium">Last holder</th>
                  <th className="text-left py-2 px-3 font-medium">Last seen</th>
                  <th className="text-left py-2 px-3 font-medium">Taps (90d)</th>
                  <th className="text-left py-2 px-3 font-medium">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-50">
                {suspicious.map((s) => (
                  <tr key={s.card_id}>
                    <td className="py-2 px-3 font-mono line-through text-gray-500">
                      {s.card_id}
                    </td>
                    <td className="py-2 px-3 text-gray-700">
                      {s.last_holder ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {formatDateTime(s.last_seen)}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{s.tap_count}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-500">
                      {s.device_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-600 mb-2">
          Unassigned ({unmapped.length})
        </h2>
        {unmapped.length === 0 ? (
          <EmptyState message="No unassigned cards seen in the last 90 days." />
        ) : (
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">Card ID</th>
                  <th className="text-left py-2 px-3 font-medium">Last seen</th>
                  <th className="text-left py-2 px-3 font-medium">Taps (90d)</th>
                  <th className="text-left py-2 px-3 font-medium">Device</th>
                  <th className="text-left py-2 px-3 font-medium">Assign to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {unmapped.map((u) => (
                  <tr key={u.card_id}>
                    <td className="py-2 px-3 font-mono">{u.card_id}</td>
                    <td className="py-2 px-3 text-gray-600">
                      {formatDateTime(u.last_seen)}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{u.tap_count}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-500">
                      {u.device_id}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={pickerByCard[u.card_id] ?? ""}
                          onChange={(e) =>
                            setPickerByCard((p) => ({
                              ...p,
                              [u.card_id]: e.target.value,
                            }))
                          }
                          className="border rounded px-2 py-1 text-sm bg-white"
                        >
                          <option value="">Select employee…</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {employeeLabel(emp)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() =>
                            assign(u.card_id, pickerByCard[u.card_id] ?? "")
                          }
                          disabled={!pickerByCard[u.card_id]}
                          className="px-3 py-1 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Assign
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-600 mb-2">
          Active assignments ({activeCards.length})
        </h2>
        {activeCards.length === 0 ? (
          <EmptyState message="No active card assignments." />
        ) : (
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">Employee</th>
                  <th className="text-left py-2 px-3 font-medium">Card ID</th>
                  <th className="text-left py-2 px-3 font-medium">Assigned</th>
                  <th className="text-left py-2 px-3 font-medium">Notes</th>
                  <th className="text-right py-2 px-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {activeCards.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 px-3 font-medium text-gray-800">
                      {c.employee ? employeeLabel(c.employee) : "—"}
                    </td>
                    <td className="py-2 px-3 font-mono">{c.card_id}</td>
                    <td className="py-2 px-3 text-gray-600">
                      {formatDateTime(c.created_at)}
                    </td>
                    <td className="py-2 px-3 text-gray-500 whitespace-pre-wrap">
                      {c.notes ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => deactivate(c)}
                        className="px-3 py-1 text-sm rounded border border-red-200 text-red-600 hover:bg-red-50"
                      >
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deactivatedCards.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Deactivated ({deactivatedCards.length})
          </h2>
          <p className="text-xs text-gray-500 mb-2">
            Lost / broken / replaced cards. The card UID is permanently retired
            and cannot be re-issued — issue a new card with a new UID instead.
          </p>
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden opacity-75">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">Last holder</th>
                  <th className="text-left py-2 px-3 font-medium">Card ID</th>
                  <th className="text-left py-2 px-3 font-medium">Deactivated</th>
                  <th className="text-left py-2 px-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {deactivatedCards.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 px-3 text-gray-700">
                      {c.employee ? employeeLabel(c.employee) : "—"}
                    </td>
                    <td className="py-2 px-3 font-mono text-gray-500 line-through">
                      {c.card_id}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {formatDateTime(c.deactivated_at)}
                    </td>
                    <td className="py-2 px-3 text-gray-500 whitespace-pre-wrap">
                      {c.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
