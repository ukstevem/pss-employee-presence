import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type WhosInRow = {
  employee_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  team: string;
  status: "in" | "out" | "never";
  first_tap_today: string | null;
  last_tap_today: string | null;
};

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("employees_whos_in_now")
    .select(
      "employee_id, full_name, first_name, last_name, team, status, first_tap_today, last_tap_today"
    )
    .order("team")
    .order("last_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as WhosInRow[];
  const employees = rows.map((r) => ({
    name: r.full_name,
    team: r.team,
    status: r.status,
    last_tap_at: r.last_tap_today,
  }));

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      counts: {
        in: rows.filter((r) => r.status === "in").length,
        out: rows.filter((r) => r.status === "out").length,
        never: rows.filter((r) => r.status === "never").length,
        total: rows.length,
      },
      employees,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
