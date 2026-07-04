import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/store/supabase";
import { XeroGateway, resolveDefaultTenantId } from "@/lib/xero/gateway";
import { buildSnapshot } from "@/lib/ingest/snapshot";

/**
 * POST /api/refresh — the ONLY path that reads live Xero (AD-3). Runs ingest
 * once through the gateway (AD-2), normalizes to the LedgerSnapshot contract,
 * and writes the snapshot to Supabase keyed by (tenantId, snapshotId) (AD-11).
 * Every downstream verdict run reads that snapshot and spends zero Xero calls.
 *
 * Body/query: optional `tenantId` (defaults to the most-recently connected
 * tenant). Returns the `{ data, error }` envelope with the new snapshotId and
 * the number of Xero calls this refresh spent (NFR-RateLimit visibility).
 */

// xero-node needs the Node runtime; a refresh must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RefreshBody {
  tenantId?: string;
}

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Resolve which tenant to refresh (explicit wins, else the connected one).
  let tenantId = req.nextUrl.searchParams.get("tenantId") ?? undefined;
  if (!tenantId) {
    const body = (await req.json().catch(() => ({}))) as RefreshBody;
    tenantId = body.tenantId;
  }
  if (!tenantId) {
    try {
      tenantId = (await resolveDefaultTenantId()) ?? undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resolve tenant.";
      return errorResponse("XERO_TENANT_RESOLVE", message, 500);
    }
  }
  if (!tenantId) {
    return errorResponse(
      "XERO_NOT_CONNECTED",
      "No connected Xero tenant. Connect an org at /api/connect first.",
      409,
    );
  }

  try {
    const gateway = await XeroGateway.for(tenantId);
    const snapshot = await buildSnapshot(gateway);

    const store = getStore();
    const { error } = await store.from("snapshots").insert({
      snapshot_id: snapshot.snapshotId,
      tenant_id: snapshot.tenantId,
      created_at: snapshot.createdAt,
      base_currency: snapshot.baseCurrency,
      ledger: snapshot,
      api_calls_today: gateway.apiCallsUsed,
    });
    if (error) {
      return errorResponse("SNAPSHOT_PERSIST", `Failed to store snapshot: ${error.message}`, 500);
    }

    return NextResponse.json({
      data: {
        tenantId: snapshot.tenantId,
        snapshotId: snapshot.snapshotId,
        createdAt: snapshot.createdAt,
        baseCurrency: snapshot.baseCurrency,
        counts: {
          contacts: snapshot.contacts.length,
          transactions: snapshot.transactions.length,
          linkedTransactions: snapshot.linkedTransactions.length,
          payments: snapshot.payments.length,
          items: snapshot.items.length,
        },
        xeroCallsUsed: gateway.apiCallsUsed,
      },
      error: null,
    });
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : "XERO_REFRESH";
    const message = err instanceof Error ? err.message : "Refresh failed.";
    // Rate-limit refusals are the common recoverable case → 429.
    const status = code === "XERO_RATE_LIMIT" ? 429 : 500;
    return errorResponse(code, message, status);
  }
}
