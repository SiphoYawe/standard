import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildConsentUrl } from "@/lib/xero/oauth";

/**
 * GET /api/connect — start the Xero OAuth2 authorization-code flow (FR-1,
 * AD-10). Generates a CSRF `state`, stores it in an httpOnly cookie, and
 * redirects the browser to the Xero consent screen. Tokens never touch the
 * client (AD-8); this route only kicks off consent.
 */

// xero-node (axios + openid-client) needs the Node runtime, not edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "xero_oauth_state";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const state = randomUUID();
    const consentUrl = await buildConsentUrl(state);

    const res = NextResponse.redirect(consentUrl);
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600, // 10 minutes to complete consent
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Xero connect.";
    return NextResponse.json(
      { data: null, error: { code: "XERO_CONNECT_START", message } },
      { status: 500 },
    );
  }
}
