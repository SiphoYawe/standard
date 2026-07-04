import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client (AD-8, NFR-Security). Uses the service-role key
 * and must never be imported into a client component. Store access is keyed by
 * (tenantId, snapshotId) per AD-11.
 */

let cached: SupabaseClient | null = null;

export function getStore(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase server env missing: set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and " +
        "SUPABASE_SERVICE_ROLE_KEY (server-only). The publishable/anon key is NOT used here — " +
        "RLS is enabled on every table, so only the service-role key can read/write server-side.",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
