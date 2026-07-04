import { NextResponse } from "next/server";

import { buildDigest, type DigestPayload } from "../_lib/digest";
import { resolveVerdict } from "../_lib/verdict-source";

/**
 * GET /api/digest — a compact monthly digest derived from the latest Verdict
 * (FR-13). Make's scheduled scenario calls this and emails the payload verbatim.
 *
 * The digest (ranked money-losers + recommended actions + KPI summary) is a
 * presentation projection of the Verdict, built in the API — never in Make
 * (AD-7). It is idempotent: it only reads the stored Verdict, no recompute, no
 * Xero calls. When NEXT_PUBLIC_USE_MOCK_VERDICT is set, or no Supabase pipeline
 * is wired, it derives the digest from the validated mock.
 *
 * Optional `tenantId` query param selects a tenant; omitted → latest verdict.
 */

export const dynamic = "force-dynamic";

type DigestResponse = { data: DigestPayload | null; error: string | null };

export async function GET(request: Request): Promise<NextResponse<DigestResponse>> {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  const { data, error } = await resolveVerdict(tenantId);

  if (!data) {
    return NextResponse.json({ data: null, error }, { status: 404 });
  }

  return NextResponse.json({ data: buildDigest(data), error: null }, { status: 200 });
}
