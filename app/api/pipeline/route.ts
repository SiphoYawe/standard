import { NextResponse, type NextRequest } from "next/server";
import { resolveDefaultTenantId } from "@/lib/xero/gateway";
import { runPipeline } from "@/lib/pipeline/run";

/**
 * POST /api/pipeline — the full on-demand run (FR-12): refresh the ledger from
 * Xero, run attribution, build and store the Verdict, and return it. This is the
 * endpoint Make's on-demand scenario triggers; the dashboard and /api/verdict
 * then read the stored result.
 *
 * Body/query:
 *   - `tenantId` (optional) — defaults to the most-recently connected tenant.
 *   - `refresh` (optional, default true) — set false to recompute from the
 *     latest cached snapshot without spending Xero calls (NFR-RateLimit).
 *
 * xero-node needs the Node runtime; the run has side effects, so never cache it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The full run makes several Xero calls plus attribution; allow more than the
// default serverless window so the connect-then-analyse flow completes.
export const maxDuration = 60;

interface PipelineBody {
  tenantId?: string;
  refresh?: boolean;
}

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as PipelineBody;
  const refreshParam = req.nextUrl.searchParams.get("refresh");
  const refresh =
    refreshParam !== null ? refreshParam !== "false" : body.refresh ?? true;

  let tenantId = req.nextUrl.searchParams.get("tenantId") ?? body.tenantId ?? undefined;
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
    const { verdict, refreshed, xeroCallsUsed } = await runPipeline(tenantId, { refresh });
    return NextResponse.json({
      data: {
        verdict,
        refreshed,
        xeroCallsUsed,
        moneyLosers: verdict.kpis.moneyLoserCount,
        snapshotId: verdict.snapshotId,
      },
      error: null,
    });
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : "PIPELINE_RUN";
    const message = err instanceof Error ? err.message : "Pipeline run failed.";
    const status = code === "XERO_RATE_LIMIT" ? 429 : 500;
    return errorResponse(code, message, status);
  }
}
