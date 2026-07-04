import { NextResponse, type NextRequest } from "next/server";
import { completeConnection, XeroScopeError } from "@/lib/xero/oauth";

/**
 * GET /api/connect/callback — the Xero redirect target (FR-1, AD-10). Verifies
 * the CSRF state, exchanges the code for tokens, resolves the tenant, and
 * persists tokens server-side (AD-8) via the gateway. Fails LOUDLY (400 JSON,
 * typed error) if Xero denied consent or granted fewer scopes than required —
 * a missing scope must surface at connect, never at write-back. On success it
 * redirects back to the dashboard with the resolved tenant.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "xero_oauth_state";

function loudError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;

  // Xero surfaces user-denied consent as ?error=access_denied.
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return loudError(
      "XERO_CONSENT_DENIED",
      `Xero consent failed: ${oauthError}`,
      400,
    );
  }

  if (!url.searchParams.get("code")) {
    return loudError("XERO_MISSING_CODE", "No authorization code on callback.", 400);
  }

  const state = req.cookies.get(STATE_COOKIE)?.value;
  if (!state) {
    return loudError(
      "XERO_MISSING_STATE",
      "Missing OAuth state cookie; restart the connect flow at /api/connect.",
      400,
    );
  }

  try {
    const result = await completeConnection(req.url, state);

    const redirectUrl = new URL("/", url.origin);
    redirectUrl.searchParams.set("connected", result.resolvedTenantId);
    const res = NextResponse.redirect(redirectUrl);
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    if (err instanceof XeroScopeError) {
      // Loud, explicit scope failure at connect time (AD-10).
      return NextResponse.json(
        {
          data: null,
          error: {
            code: err.code,
            message: err.message,
            missing: err.missing,
            granted: err.granted,
          },
        },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : "Xero connect callback failed.";
    return loudError("XERO_CONNECT_CALLBACK", message, 500);
  }
}
