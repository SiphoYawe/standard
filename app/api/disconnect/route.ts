import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/store/supabase";
import { resolveDefaultTenantId } from "@/lib/xero/gateway";

/**
 * POST /api/disconnect - remove a connected Xero organisation. Deletes the
 * tenant's tokens and all derived data (snapshots, verdicts, write-back runs,
 * rate budget) so the app returns to its connect-first state. Child rows are
 * removed before xero_tokens to respect foreign keys.
 *
 * Body/query: optional `tenantId` (defaults to the most-recently connected).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let tenantId = req.nextUrl.searchParams.get("tenantId") ?? undefined;
  if (!tenantId) {
    const body = (await req.json().catch(() => ({}))) as { tenantId?: string };
    tenantId = body.tenantId;
  }
  if (!tenantId) {
    try {
      tenantId = (await resolveDefaultTenantId()) ?? undefined;
    } catch {
      /* fall through to the 409 below */
    }
  }
  if (!tenantId) {
    return NextResponse.json(
      { data: null, error: { code: "NO_TENANT", message: "No connected organisation to disconnect." } },
      { status: 409 },
    );
  }

  try {
    const store = getStore();
    // Order matters for the FKs: verdicts -> snapshots -> xero_tokens.
    for (const table of ["verdicts", "snapshots", "writeback_runs", "xero_rate_budget", "xero_tokens"]) {
      const { error } = await store.from(table).delete().eq("tenant_id", tenantId);
      if (error) {
        return NextResponse.json(
          { data: null, error: { code: "DISCONNECT_FAILED", message: `Failed clearing ${table}: ${error.message}` } },
          { status: 500 },
        );
      }
    }
    return NextResponse.json({ data: { disconnected: tenantId }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Disconnect failed.";
    return NextResponse.json(
      { data: null, error: { code: "DISCONNECT_FAILED", message } },
      { status: 500 },
    );
  }
}
