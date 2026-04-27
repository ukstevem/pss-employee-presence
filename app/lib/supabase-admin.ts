import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for endpoints that need to bypass RLS (e.g.
// /api/roll-call, called by the e-ink panel without user auth).
// NEVER import this from a client component — the secret key would
// leak into the browser bundle.
//
// Lazy: the env-var check runs the first time the client is used,
// not at module load. Otherwise Next.js's build-time page-data
// collection would throw before runtime env is available.

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "supabase-admin requires SUPABASE_URL and SUPABASE_SECRET_KEY in env"
    );
  }

  _client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
