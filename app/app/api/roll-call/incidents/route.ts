import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type IncidentRow = {
  device_id: string;
  started_at: string;
  ended_at?: string;
  snapshot_at?: string;
  expected_count: number;
  accounted_count: number;
  outstanding?: Array<{ id?: string; name: string; team?: string }>;
  exceptions?: Array<{ id?: string; name: string; team?: string; status?: string }>;
};

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  let body: IncidentRow;
  try {
    body = (await req.json()) as IncidentRow;
  } catch {
    return badRequest("invalid json");
  }

  if (!body.device_id) return badRequest("missing device_id");
  if (!body.started_at) return badRequest("missing started_at");
  if (typeof body.expected_count !== "number") return badRequest("missing expected_count");
  if (typeof body.accounted_count !== "number") return badRequest("missing accounted_count");

  const { data, error } = await getSupabaseAdmin()
    .from("employees_roll_call_incidents")
    .insert({
      device_id: body.device_id,
      started_at: body.started_at,
      ended_at: body.ended_at ?? new Date().toISOString(),
      snapshot_at: body.snapshot_at ?? null,
      expected_count: body.expected_count,
      accounted_count: body.accounted_count,
      outstanding: body.outstanding ?? [],
      exceptions: body.exceptions ?? [],
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
