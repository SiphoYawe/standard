import { XeroClient, type TokenSet } from "xero-node";
import { saveTokenSet } from "./gateway";

/**
 * OAuth2 authorization-code helpers (AD-10). Builds the consent URL with the
 * fixed submission scope set, exchanges the callback code for tokens, verifies
 * the granted scopes (fails loudly if any required one is missing — a missing
 * scope must fail at connect, not later at write-back), resolves the tenant via
 * /connections, and persists tokens server-side (AD-8) through the gateway,
 * which is the only holder of tokens (AD-2).
 *
 * All Xero I/O here is via `xero-node` inside `lib/xero`, per AD-2.
 */

/**
 * The exact submission scope set (see spine "Xero API Surface"). The non-`.read`
 * variants cover both read and write; `accounting.reports.read` is read-only.
 * Story 1.1 requires these EXACT scopes.
 */
export const FIXED_XERO_SCOPES =
  "offline_access accounting.contacts accounting.transactions accounting.settings accounting.reports.read";

/** Scopes actually requested at connect — env override, else the fixed set. */
export function getConfiguredScopes(): string[] {
  const raw = (process.env.XERO_SCOPES ?? FIXED_XERO_SCOPES).trim();
  return raw.split(/\s+/).filter(Boolean);
}

/** Raised when Xero granted fewer scopes than required (AD-10, fail loudly). */
export class XeroScopeError extends Error {
  readonly code = "XERO_SCOPE_MISSING";
  constructor(
    readonly missing: string[],
    readonly granted: string[],
  ) {
    super(`Missing required Xero scope(s): ${missing.join(", ")}`);
    this.name = "XeroScopeError";
  }
}

interface OAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

function readOAuthEnv(): OAuthEnv {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const redirectUri = process.env.XERO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Xero OAuth env missing: set XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI (server-only).",
    );
  }
  return { clientId, clientSecret, redirectUri, scopes: getConfiguredScopes() };
}

/** A fresh XeroClient configured for the auth-code flow, bound to a CSRF state. */
function makeAuthClient(state?: string): XeroClient {
  const env = readOAuthEnv();
  return new XeroClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUris: [env.redirectUri],
    scopes: env.scopes,
    state,
  });
}

/** Build the Xero consent URL for the given CSRF state (FR-1, AD-10). */
export async function buildConsentUrl(state: string): Promise<string> {
  const client = makeAuthClient(state);
  return client.buildConsentUrl();
}

export interface ConnectedTenant {
  tenantId: string;
  tenantName: string;
}

export interface ConnectionResult {
  tenants: ConnectedTenant[];
  /** The tenant to work with (most-recently-active, index 0). */
  resolvedTenantId: string;
  grantedScopes: string[];
}

/**
 * Verify every required scope was granted. `offline_access` is verified
 * indirectly via presence of a refresh token (Xero does not always echo it in
 * the scope string), so its absence still fails loudly.
 */
function assertScopesGranted(tokenSet: TokenSet): string[] {
  const granted = new Set(
    (tokenSet.scope ?? "").split(/\s+/).filter(Boolean),
  );
  const missing = getConfiguredScopes().filter(
    (s) => s !== "offline_access" && !granted.has(s),
  );
  if (!tokenSet.refresh_token) missing.push("offline_access");
  if (missing.length) throw new XeroScopeError(missing, [...granted]);
  return [...granted];
}

/**
 * Complete the auth-code flow from the callback URL: exchange the code, verify
 * scopes (fail loudly), resolve the tenant(s) via /connections, and persist a
 * token row per tenant server-side (AD-8, AD-10).
 */
export async function completeConnection(
  callbackUrl: string,
  state: string,
): Promise<ConnectionResult> {
  const client = makeAuthClient(state);
  const tokenSet = await client.apiCallback(callbackUrl);

  const grantedScopes = assertScopesGranted(tokenSet);

  // /connections (Xero Identity) — owner + tenant identity. `false` skips the
  // extra per-org getOrganisations calls to conserve the rate budget.
  const tenants = await client.updateTenants(false);
  if (!tenants || tenants.length === 0) {
    throw new Error("Xero returned no connected tenants from /connections.");
  }

  const mapped: ConnectedTenant[] = tenants.map((t) => ({
    tenantId: String(t.tenantId),
    tenantName: String(t.tenantName ?? ""),
  }));

  const scopeString = tokenSet.scope ?? getConfiguredScopes().join(" ");
  // One token row per tenant; the same token set authorises each connection.
  for (const t of mapped) {
    await saveTokenSet(t.tenantId, t.tenantName, tokenSet, scopeString);
  }

  return {
    tenants: mapped,
    resolvedTenantId: mapped[0].tenantId,
    grantedScopes,
  };
}
