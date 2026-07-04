import { getMockVerdict } from "@/lib/contracts/mock";
import { parseVerdict, type Verdict } from "@/lib/contracts/verdict";
import { getStore } from "@/lib/store/supabase";

/**
 * Resolves the latest {@link Verdict} for a tenant (AD-4).
 *
 * Track D owns orchestration only. This helper *reads* a Verdict the attribution
 * engine (Track B) already computed and stored — it never recomputes, never
 * calls Xero, and has no side effects. That is what keeps both GET and POST on
 * the verdict endpoint idempotent (AD-7 "Make orchestrates, code computes";
 * NFR-RateLimit "re-runs use cached data").
 */

export type VerdictResult =
  | { data: Verdict; error: null }
  | { data: null; error: string };

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalised = value.trim().toLowerCase();
  return (
    normalised === "1" ||
    normalised === "true" ||
    normalised === "yes" ||
    normalised === "on"
  );
}

/**
 * True when the app should serve the validated mock instead of live data:
 * either the explicit demo flag is set (BUILD.md) or no Supabase pipeline is
 * wired, so there is nothing live to read yet.
 */
export function shouldServeMock(): boolean {
  if (isTruthyFlag(process.env.NEXT_PUBLIC_USE_MOCK_VERDICT)) return true;
  const supabaseWired =
    Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return !supabaseWired;
}

/**
 * Reads the most recent stored Verdict for the given tenant (or the single most
 * recent verdict of any tenant when `tenantId` is omitted). Validates it against
 * the frozen contract (AD-4) before returning so no consumer sees a drifted shape.
 */
export async function resolveVerdict(
  tenantId?: string | null,
): Promise<VerdictResult> {
  if (shouldServeMock()) {
    return { data: getMockVerdict(), error: null };
  }

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
        error: `No verdict found${scope}. Run POST /api/refresh, then the attribution pipeline.`,
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
