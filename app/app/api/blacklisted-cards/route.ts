import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// List of card UIDs the M5 readers should refuse locally (red LED + buzzer)
// instead of letting the tap propagate as a silently-ignored event. The
// firmware pulls this on its own timer and stores the list in flash.

export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from("employee_cards")
    .select("card_id, deactivated_at")
    .eq("active", false)
    .order("deactivated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const card_ids = (data ?? []).map((r: { card_id: string }) => r.card_id);

  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      count: card_ids.length,
      card_ids,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
