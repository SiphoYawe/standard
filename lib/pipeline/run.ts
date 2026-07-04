import { LedgerSnapshot } from "@/lib/contracts/ledger";
import type { Verdict } from "@/lib/contracts/verdict";
import type { OwnerTimeInput } from "@/lib/attribution";
import { buildVerdict } from "@/lib/verdict/build";
import { buildSnapshot } from "@/lib/ingest/snapshot";
import { XeroGateway } from "@/lib/xero/gateway";
import { getStore } from "@/lib/store/supabase";

/**
 * The end-to-end pipeline glue (FR-12): the seam between Track A (ingest →
 * snapshot), Track B (attribution → verdict), and the store. Track A's
 * /api/refresh only produces a snapshot; this turns a snapshot into a stored,
 * contract-valid Verdict the dashboard and Make read.
 *
 * Ordering respects the architecture: Xero I/O stays behind the gateway (AD-2),
 * attribution reads the cached snapshot not live Xero (AD-3), and the Verdict is
 * validated against the contract inside buildVerdict before it is stored (AD-4).
 */

/** Load the most recent Ledger snapshot for a tenant (AD-3, AD-11). */
export async function loadLatestSnapshot(
  tenantId: string,
): Promise<LedgerSnapshot | null> {
  const store = getStore();
  const { data, error } = await store
    .from("snapshots")
    .select("ledger")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Snapshot read failed: ${error.message}`);
  if (!data) return null;
  // The snapshot was validated on write; validate again on read so a drifted
  // row can never reach the engine.
  return LedgerSnapshot.parse((data as { ledger: unknown }).ledger);
}

/** The connected org's display name, for the Verdict header. */
async function loadTenantName(tenantId: string): Promise<string | undefined> {
  const store = getStore();
  const { data } = await store
    .from("xero_tokens")
    .select("tenant_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const name = (data as { tenant_name?: string } | null)?.tenant_name;
  return name ?? undefined;
}

/** Persist a computed Verdict (AD-4). */
async function storeVerdict(verdict: Verdict): Promise<void> {
  const store = getStore();
  const { error } = await store.from("verdicts").insert({
    tenant_id: verdict.tenantId,
    snapshot_id: verdict.snapshotId,
    verdict,
  });
  if (error) throw new Error(`Verdict persist failed: ${error.message}`);
}

/**
 * Run attribution on the latest snapshot and store the resulting Verdict.
 * Uses the LLM proposal pass only when ANTHROPIC_API_KEY is present; otherwise
 * the deterministic fallback still produces a valid Verdict (AD-9).
 *
 * `ownerTime` (FR-7) is optional and off by default: when omitted, owner-time
 * contributes 0 and the verdict is unchanged; when supplied it is forwarded to
 * buildVerdict, which includes it in true margin as a labelled owner estimate.
 */
export async function computeAndStoreVerdict(
  tenantId: string,
  opts: { ownerTime?: OwnerTimeInput } = {},
): Promise<Verdict> {
  const snapshot = await loadLatestSnapshot(tenantId);
  if (!snapshot) {
    throw new Error(
      `No snapshot for tenant ${tenantId}. Run POST /api/refresh first.`,
    );
  }
  const tenantName = await loadTenantName(tenantId);
  const verdict = await buildVerdict(snapshot, {
    tenantName,
    useLlm: Boolean(process.env.ANTHROPIC_API_KEY),
    ownerTime: opts.ownerTime,
  });
  await storeVerdict(verdict);
  return verdict;
}

/**
 * The full on-demand run (FR-12): refresh the ledger from Xero into a new
 * snapshot, then compute and store the Verdict. This is the single call Make's
 * on-demand scenario triggers. Set `refresh=false` to skip the Xero read and
 * recompute from the latest cached snapshot (zero Xero calls, NFR-RateLimit).
 *
 * `ownerTime` (FR-7) is optional and off by default; when supplied it is
 * forwarded through to the verdict as a labelled owner-time estimate.
 */
export async function runPipeline(
  tenantId: string,
  opts: { refresh?: boolean; ownerTime?: OwnerTimeInput } = {},
): Promise<{ verdict: Verdict; refreshed: boolean; xeroCallsUsed: number }> {
  let xeroCallsUsed = 0;
  const refresh = opts.refresh ?? true;

  if (refresh) {
    const gateway = await XeroGateway.for(tenantId);
    const snapshot = await buildSnapshot(gateway);
    xeroCallsUsed = gateway.apiCallsUsed;
    const store = getStore();
    const { error } = await store.from("snapshots").insert({
      snapshot_id: snapshot.snapshotId,
      tenant_id: snapshot.tenantId,
      created_at: snapshot.createdAt,
      base_currency: snapshot.baseCurrency,
      ledger: snapshot,
      api_calls_today: gateway.apiCallsUsed,
    });
    if (error) throw new Error(`Snapshot persist failed: ${error.message}`);
  }

  const verdict = await computeAndStoreVerdict(tenantId, { ownerTime: opts.ownerTime });
  return { verdict, refreshed: refresh, xeroCallsUsed };
}
