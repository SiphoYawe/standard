import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cookie-bound server client (Supabase SSR pattern) using the publishable key.
 * This is for any future user-auth / RLS-scoped reads from Server Components.
 *
 * NOTE: Standard's data store (snapshots, verdicts, xero_tokens) is accessed
 * server-side with the SERVICE-ROLE key via `lib/store/supabase.ts` — RLS is on,
 * so this publishable-key client cannot read those tables. Keep it that way.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const createClient = (cookieStore: Awaited<ReturnType<typeof cookies>>) => {
  return createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore when middleware
          // refreshes sessions.
        }
      },
    },
  });
};
