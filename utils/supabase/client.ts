import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client using the publishable key. RLS is enabled on all Standard
 * tables with no anon policies, so this client can read nothing from the data
 * store — that is intentional. It exists only for any future client-side,
 * per-user Supabase features.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const createClient = () => createBrowserClient(supabaseUrl!, supabaseKey!);
