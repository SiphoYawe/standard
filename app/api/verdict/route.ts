import { NextResponse } from "next/server";

import type { Verdict } from "@/lib/contracts/verdict";
import { resolveVerdict } from "../_lib/verdict-source";

/**
 * GET / POST /api/verdict — returns the latest {@link Verdict} (AD-4, FR-12).
 *
 * This is the endpoint Make's on-demand scenario calls. It is idempotent
 * (AD-7): it only *reads* the Verdict the pipeline already computed and stored,
 * so repeat calls return cached data and never touch Xero (AD-3, NFR-RateLimit).
 * Refreshing the ledger from Xero is a separate concern — POST /api/refresh,
 * owned by Track A. When NEXT_PUBLIC_USE_MOCK_VERDICT is set, or no Supabase
 * pipeline is wired, it returns the validated mock so the app is demoable
 * immediately.
 *
 * Optional `tenantId` selects a specific tenant (query string on GET/POST, or a
 * JSON body field `{ "tenantId": "..." }` on POST). Omitted → latest verdict.
 */

// Always run at request time so callers get the latest stored verdict, never a
// build-time snapshot. The handler has no side effects, so it stays idempotent.
export const dynamic = "force-dynamic";

type VerdictResponse = { data: Verdict | null; error: string | null };

async function readTenantId(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("tenantId");
  if (fromQuery) return fromQuery;

  if (request.method === "POST") {
    const body: unknown = await request.json().catch(() => null);
    if (body && typeof body === "object" && "tenantId" in body) {
      const value = (body as Record<string, unknown>).tenantId;
      if (typeof value === "string" && value.length > 0) return value;
    }
  }

  return null;
}

async function handle(request: Request): Promise<NextResponse<VerdictResponse>> {
  const tenantId = await readTenantId(request);
  const { data, error } = await resolveVerdict(tenantId);
  const body: VerdictResponse = { data, error };
  // 200 when we have a verdict, 404 when the tenant has none yet.
  return NextResponse.json(body, { status: data ? 200 : 404 });
}

export async function GET(request: Request): Promise<NextResponse<VerdictResponse>> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse<VerdictResponse>> {
  return handle(request);
}
