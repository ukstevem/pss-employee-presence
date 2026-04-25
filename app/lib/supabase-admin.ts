import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client for endpoints that need to bypass RLS (e.g.
// /api/roll-call, called by the e-ink panel without user auth). NEVER
// import this from a client component — the secret key would leak into
// the browser bundle.

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  throw new Error(
    "supabase-admin requires SUPABASE_URL and SUPABASE_SECRET_KEY in env"
  );
}

export const supabaseAdmin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
