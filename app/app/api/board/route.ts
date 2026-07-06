import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// No-auth read surface for the public /board kiosk (LAN-only tablet
// display). Reads the full employees_whos_in_now view via the
// service-role client so the browser never needs credentials — same
// pattern as /api/roll-call.
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
  tap_count_today: number;
};

export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("employees_whos_in_now")
    .select(
      "employee_id, full_name, first_name, last_name, team, status, first_tap_today, last_tap_today, tap_count_today"
    )
    .order("team")
    .order("last_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as WhosInRow[];

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      counts: {
        in: rows.filter((r) => r.status === "in").length,
        out: rows.filter((r) => r.status === "out").length,
        never: rows.filter((r) => r.status === "never").length,
        total: rows.length,
      },
      rows,
    },
    {
      headers: { "cache-control": "no-store" },
    }
  );
}
