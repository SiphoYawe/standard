import { NextResponse, type NextRequest } from "next/server";

import {
  applyWriteback,
  previewWriteback,
  WritebackError,
  type WritebackPreview,
  type WritebackResult,
} from "@/lib/writeback";

/**
 * POST /api/writeback (FR-11, AD-6, AD-2). Re-tags confirmed, editable Xero
 * lines into the "Standard Customer" tracking category so the owner's native
 * P&L-by-tracking-category shows each customer's true margin.
 *
 * Body: { tenantId?, mode?: "preview" | "apply", allocationIds?: string[] }.
 *   - mode defaults to "preview": a pure dry-run diff, zero writes (AD-6).
 *   - mode "apply": creates/reuses the category + a per-customer option, then
 *     writes only editable lines through the gateway (AD-2) and records the run.
 *   - allocationIds confirms otherwise-unconfirmed Low-confidence allocations;
 *     High/Medium confirm automatically. Shared overhead is never written.
 *   - tenantId defaults to the tenant of the most recent stored Verdict.
 *
 * Always returns the { data, error } envelope. When Supabase is not wired it
 * returns a clear error instead of crashing.
 */

// xero-node needs the Node runtime; write-back must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "preview" | "apply";

interface WritebackRequestBody {
  tenantId?: string;
  mode?: Mode;
  allocationIds?: string[];
}

type WritebackResponse =
  | { data: WritebackPreview | WritebackResult; error: null }
  | { data: null; error: { code: string; message: string } };

function errorResponse(
  code: string,
  message: string,
  status: number,
): NextResponse<WritebackResponse> {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

/** Map a domain error code to an HTTP status. */
function statusForCode(code: string): number {
  switch (code) {
    case "SUPABASE_NOT_WIRED":
      return 503;
    case "NO_VERDICT":
    case "NO_SNAPSHOT":
      return 404;
    case "XERO_AUTH":
      return 401;
    case "XERO_RATE_LIMIT":
      return 429;
    default:
      return 500;
  }
}

function readCode(err: unknown): string {
  if (err instanceof WritebackError) return err.code;
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "WRITEBACK_FAILED";
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<WritebackResponse>> {
  const body = (await req.json().catch(() => ({}))) as WritebackRequestBody;

  const tenantId =
    req.nextUrl.searchParams.get("tenantId") ?? body.tenantId ?? undefined;

  const modeParam = req.nextUrl.searchParams.get("mode") ?? body.mode ?? "preview";
  const mode: Mode = modeParam === "apply" ? "apply" : "preview";

  const allocationIds = Array.isArray(body.allocationIds)
    ? body.allocationIds.filter((id): id is string => typeof id === "string")
    : undefined;

  try {
    const data =
      mode === "apply"
        ? await applyWriteback(tenantId, allocationIds)
        : await previewWriteback(tenantId, allocationIds);
    return NextResponse.json({ data, error: null });
  } catch (err) {
    const code = readCode(err);
    const message = err instanceof Error ? err.message : "Write-back failed.";
    return errorResponse(code, message, statusForCode(code));
  }
}
