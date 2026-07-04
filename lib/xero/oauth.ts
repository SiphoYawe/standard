import { XeroClient, type TokenSet } from "xero-node";
import { saveTokenSet } from "./gateway";

/**
 * OAuth2 authorization-code helpers (AD-10). Builds the consent URL with the
 * fixed submission scope set, exchanges the callback code for tokens, verifies
 * the granted scopes (fails loudly if any required one is missing, so a missing
 * scope surfaces at connect and never later at write-back), resolves the tenant
 * via /connections, and persists tokens server-side (AD-8) through the gateway,
 * which is the only holder of tokens (AD-2).
 *
 * All Xero I/O here is via `xero-node` inside `lib/xero`, per AD-2.
 */

/**
 * The exact submission scope set (see spine "Xero API Surface"). The non-`.read`
 * variants cover both read and write; `accounting.reports.read` is read-only.
 * Story 1.1 requires these EXACT scopes. This is the invariant the connect flow
 * verifies against, independent of any env override (a misconfigured env can
 * never silently drop a required scope, see getConfiguredScopes below).
 */
export const REQUIRED_XERO_SCOPES: readonly string[] = [
  "offline_access",
  "accounting.contacts",
  "accounting.transactions",
  "accounting.settings",
  "accounting.reports.read",
];

export const FIXED_XERO_SCOPES = REQUIRED_XERO_SCOPES.join(" ");

/**
 * Broad Accounting scopes are being replaced by granular ones (Xero doc:
 * "since March 2026, all new and existing Web and PKCE apps have been assigned
 * granular scopes"). A modern Xero app may therefore grant a granular scope
 * (e.g. `accounting.invoices`) in place of the broad scope we request
 * (`accounting.transactions`). The connect check must treat those grants as
 * satisfying the requirement, otherwise a fully-consented modern org would fail
 * loudly for the wrong reason. Each required broad scope is "satisfied" if the
 * granted set contains the scope itself OR any recognised equivalent below.
 * (A `.read`-only grant still proves consent to that data area; a later write
 * that lacks the write scope surfaces its own explicit Xero error at write-back.)
 */
const SCOPE_EQUIVALENTS: Record<string, readonly string[]> = {
  "accounting.transactions": [
    "accounting.transactions",
    "accounting.transactions.read",
    "accounting.invoices",
    "accounting.invoices.read",
    "accounting.payments",
    "accounting.payments.read",
    "accounting.banktransactions",
    "accounting.banktransactions.read",
  ],
  "accounting.contacts": ["accounting.contacts", "accounting.contacts.read"],
  "accounting.settings": ["accounting.settings", "accounting.settings.read"],
  "accounting.reports.read": [
    "accounting.reports.read",
    "accounting.reports.profitandloss.read",
  ],
};

/**
 * Scopes actually requested at connect. Defaults to the fixed set; an env
 * override is allowed ONLY if it still contains every required scope. A request
 * that drops a required scope guarantees a later failure, so we refuse it up
 * front (loud config error at connect start) rather than degrade silently.
 */
export function getConfiguredScopes(): string[] {
  const raw = (process.env.XERO_SCOPES ?? FIXED_XERO_SCOPES).trim();
  const requested = raw.split(/\s+/).filter(Boolean);
  const requestedSet = new Set(requested);
  const missing = REQUIRED_XERO_SCOPES.filter((s) => !requestedSet.has(s));
  if (missing.length) {
    throw new Error(
      `XERO_SCOPES is misconfigured: it must request every required scope but is missing ` +
        `${missing.join(", ")}. Required: "${FIXED_XERO_SCOPES}".`,
    );
  }
  return requested;
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
  // buildConsentUrl self-initializes (issuer discovery) if needed.
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

/** True when the granted set satisfies one required scope (self or equivalent). */
function isScopeSatisfied(required: string, granted: Set<string>): boolean {
  if (granted.has(required)) return true;
  const equivalents = SCOPE_EQUIVALENTS[required];
  return equivalents ? equivalents.some((s) => granted.has(s)) : false;
}

/**
 * Verify every required scope was granted, tolerating granular equivalents.
 * `offline_access` is verified indirectly via presence of a refresh token (Xero
 * does not always echo it in the scope string), so its absence still fails
 * loudly. Returns the granted scope list on success.
 */
function assertScopesGranted(tokenSet: TokenSet): string[] {
  const granted = new Set(
    (typeof tokenSet.scope === "string" ? tokenSet.scope : "")
      .split(/\s+/)
      .filter(Boolean),
  );

  const missing: string[] = [];
  for (const required of REQUIRED_XERO_SCOPES) {
    if (required === "offline_access") {
      if (!tokenSet.refresh_token) missing.push("offline_access");
      continue;
    }
    if (!isScopeSatisfied(required, granted)) missing.push(required);
  }

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
  // Exchanges the code and validates the CSRF state param against `state`.
  const tokenSet = await client.apiCallback(callbackUrl);

  const grantedScopes = assertScopesGranted(tokenSet);

  // /connections (Xero Identity) resolves owner + tenant identity. `false`
  // skips the extra per-org getOrganisations calls to conserve rate budget.
  const tenants = await client.updateTenants(false);
  if (!tenants || tenants.length === 0) {
    throw new Error("Xero returned no connected tenants from /connections.");
  }

  const mapped: ConnectedTenant[] = tenants
    // Guard against non-organisation connections (e.g. practice tenants) that
    // carry no orgId; the accounting API needs an organisation tenantId.
    .filter((t) => t && t.tenantId)
    .map((t) => ({
      tenantId: String(t.tenantId),
      tenantName: String(t.tenantName ?? ""),
    }));

  if (mapped.length === 0) {
    throw new Error("Xero returned connections but none had a usable tenantId.");
  }

  // Persist the granted scope string (falls back to the requested set). Xero
  // echoes granted scopes here; the same token set authorises every connection.
  const scopeString =
    typeof tokenSet.scope === "string" && tokenSet.scope.length
      ? tokenSet.scope
      : getConfiguredScopes().join(" ");
  for (const t of mapped) {
    await saveTokenSet(t.tenantId, t.tenantName, tokenSet, scopeString);
  }

  return {
    tenants: mapped,
    resolvedTenantId: mapped[0].tenantId,
    grantedScopes,
  };
}
