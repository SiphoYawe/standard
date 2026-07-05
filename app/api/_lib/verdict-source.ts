import { parseVerdict, type Verdict } from "@/lib/contracts/verdict";
import { getStore } from "@/lib/store/supabase";

/**
 * Resolves the latest {@link Verdict} for a tenant (AD-4).
 *
 * Track D owns orchestration only. This helper *reads* a Verdict the attribution
 * engine (Track B) already computed and stored - it never recomputes, never
 * calls Xero, and has no side effects. That is what keeps both GET and POST on
 * the verdict endpoint idempotent (AD-7 "Make orchestrates, code computes";
 * NFR-RateLimit "re-runs use cached data").
 *
 * This resolver is real-only. When Supabase is not wired, or no Verdict has been
 * stored for the tenant yet, it returns `{ data: null }`. The product never
 * fabricates a verdict for a user: the dashboard stays connect-first until real
 * Xero data has been ingested and a Verdict computed.
 */

export type VerdictResult =
  | { data: Verdict; error: null }
  | { data: null; error: string };

/**
 * Reads the most recent stored Verdict for the given tenant (or the single most
 * recent verdict of any tenant when `tenantId` is omitted). Validates it against
 * the frozen contract (AD-4) before returning so no consumer sees a drifted
 * shape. Returns `{ data: null }` when the store is unwired/unreachable or empty
 * - never a mock.
 */
export async function resolveVerdict(
  tenantId?: string | null,
): Promise<VerdictResult> {
  try {
    const store = getStore();
    let query = store
      .from("verdicts")
      .select("verdict")
      .order("created_at", { ascending: false })
      .limit(1);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      return { data: null, error: `Store read failed: ${error.message}` };
    }
    if (!data) {
      const scope = tenantId ? ` for tenant ${tenantId}` : "";
      return {
        data: null,
        error: `No verdict found${scope}. Connect a Xero organisation, then run the refresh + attribution pipeline.`,
      };
    }

    const row = data as { verdict: unknown };
    return { data: parseVerdict(row.verdict), error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown store error.",
    };
  }
}

/**
 * True when at least one Xero organisation is connected (a token row exists).
 * Distinguishes "not connected yet" (show the connect screen) from "connected
 * but no verdict computed yet" (run the analysis), so a fresh connect never
 * lands the user back on the connect screen with nothing happening.
 */
export async function hasConnectedOrg(): Promise<boolean> {
  try {
    const store = getStore();
    const { data } = await store
      .from("xero_tokens")
      .select("tenant_id")
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}
