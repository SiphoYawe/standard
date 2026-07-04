import {
  XeroClient,
  type TokenSet,
  type TokenSetParameters,
  type Contact,
  type Contacts,
  type Invoice,
  type Invoices,
  type BankTransaction,
  type BankTransactions,
  type Payment,
  type Payments,
  type LinkedTransaction,
  type LinkedTransactions,
  type Item,
  type Items,
  type Quote,
  type Quotes,
  type TrackingCategory,
  type TrackingCategories,
  type TrackingOption,
  type TrackingOptions,
  type ReportWithRows,
} from "xero-node";
import { getStore } from "@/lib/store/supabase";

/**
 * The single Xero gateway (AD-2). This is the ONLY module in the app that
 * imports `xero-node` or issues Xero HTTP. It is the sole holder of tokens
 * (AD-10) and the sole place the per-tenant daily rate budget is counted
 * (NFR-RateLimit). Every read/write in the spine's "Xero API Surface" table
 * is exposed here as a typed method; higher layers (ingest, write-back) call
 * these and never touch the SDK.
 *
 * Cache-first (AD-3): only `POST /api/refresh` drives the read methods; all
 * downstream stages read the Supabase snapshot, not this gateway.
 */

/* ------------------------------------------------------------------ *
 * Typed errors ({ data, error } envelope wants typed, not-bare errors)
 * ------------------------------------------------------------------ */

export class XeroGatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "XeroGatewayError";
  }
}

/** No stored tokens / refresh failure for a tenant (AD-10). */
export class XeroAuthError extends XeroGatewayError {
  constructor(message: string) {
    super(message, "XERO_AUTH");
    this.name = "XeroAuthError";
  }
}

/** Daily/near-cap budget refusal (NFR-RateLimit). */
export class XeroRateLimitError extends XeroGatewayError {
  constructor(message: string) {
    super(message, "XERO_RATE_LIMIT");
    this.name = "XeroRateLimitError";
  }
}

/* ------------------------------------------------------------------ *
 * Token custody (AD-10) — the gateway is the only holder of tokens.
 * Persisted server-side in Supabase `xero_tokens`, one row per tenant.
 * ------------------------------------------------------------------ */

export interface XeroTokenRecord {
  tenantId: string;
  tenantName: string;
  accessToken: string;
  refreshToken: string;
  /** ISO 8601 UTC. */
  expiresAt: string;
  /** Space-delimited granted scope string. */
  scopes: string;
}

/**
 * Persist a freshly issued/refreshed token set for a tenant (AD-8, AD-10).
 * Called from the OAuth handshake and from token refresh; never client-side.
 */
export async function saveTokenSet(
  tenantId: string,
  tenantName: string,
  tokenSet: TokenSet,
  scopes: string,
): Promise<void> {
  if (!tokenSet.access_token || !tokenSet.refresh_token) {
    throw new XeroAuthError(
      "Xero token set is missing access or refresh token (offline_access not granted?)",
    );
  }
  const expiresAt = new Date((tokenSet.expires_at ?? 0) * 1000).toISOString();
  const store = getStore();
  const { error } = await store.from("xero_tokens").upsert(
    {
      tenant_id: tenantId,
      tenant_name: tenantName,
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      expires_at: expiresAt,
      scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    throw new XeroGatewayError(
      `Failed to persist Xero tokens: ${error.message}`,
      "XERO_TOKEN_STORE",
    );
  }
}

/** Load the stored token record for a tenant, or null if not connected. */
export async function loadTokenRecord(
  tenantId: string,
): Promise<XeroTokenRecord | null> {
  const store = getStore();
  const { data, error } = await store
    .from("xero_tokens")
    .select("tenant_id, tenant_name, access_token, refresh_token, expires_at, scopes")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    throw new XeroGatewayError(
      `Failed to load Xero tokens: ${error.message}`,
      "XERO_TOKEN_STORE",
    );
  }
  if (!data) return null;
  const row = data as {
    tenant_id: string;
    tenant_name: string | null;
    access_token: string;
    refresh_token: string;
    expires_at: string;
    scopes: string | null;
  };
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name ?? "",
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scopes: row.scopes ?? "",
  };
}

/** Pick the most-recently connected tenant when the caller didn't name one. */
export async function resolveDefaultTenantId(): Promise<string | null> {
  const store = getStore();
  const { data, error } = await store
    .from("xero_tokens")
    .select("tenant_id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new XeroGatewayError(
      `Failed to resolve default tenant: ${error.message}`,
      "XERO_TOKEN_STORE",
    );
  }
  const row = data as { tenant_id: string } | null;
  return row?.tenant_id ?? null;
}

/* ------------------------------------------------------------------ *
 * Rate budget (NFR-RateLimit) — per-tenant, per-day call counter.
 * Xero uncertified cap is 1,000/day/tenant and does NOT reset on demo reset,
 * so the gateway refuses non-essential reads as it approaches the cap.
 * ------------------------------------------------------------------ */

const DAILY_CAP = Number(process.env.XERO_DAILY_CAP ?? 1000);
const SOFT_CAP = Number(process.env.XERO_DAILY_SOFT_CAP ?? 950);

function utcDay(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function readDailyCalls(tenantId: string): Promise<number> {
  try {
    const store = getStore();
    const { data } = await store
      .from("xero_rate_budget")
      .select("calls")
      .eq("tenant_id", tenantId)
      .eq("day", utcDay())
      .maybeSingle();
    return (data as { calls?: number } | null)?.calls ?? 0;
  } catch {
    // Degrade gracefully: never let the counter block a demo read.
    return 0;
  }
}

async function bumpDailyCalls(tenantId: string, n: number): Promise<void> {
  try {
    const store = getStore();
    const day = utcDay();
    const { data } = await store
      .from("xero_rate_budget")
      .select("calls")
      .eq("tenant_id", tenantId)
      .eq("day", day)
      .maybeSingle();
    const next = ((data as { calls?: number } | null)?.calls ?? 0) + n;
    await store.from("xero_rate_budget").upsert(
      { tenant_id: tenantId, day, calls: next, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,day" },
    );
  } catch {
    // Best-effort accounting; do not fail the underlying Xero call.
  }
}

async function assertBudget(tenantId: string, essential: boolean): Promise<void> {
  const used = await readDailyCalls(tenantId);
  if (used >= DAILY_CAP) {
    throw new XeroRateLimitError(
      `Daily Xero call cap reached for tenant ${tenantId} (${used}/${DAILY_CAP}).`,
    );
  }
  if (!essential && used >= SOFT_CAP) {
    throw new XeroRateLimitError(
      `Near daily Xero cap for tenant ${tenantId} (${used}/${DAILY_CAP}); non-essential read refused.`,
    );
  }
}

/** Xero returns 100 records per page for the paged accounting endpoints. */
const PAGE_SIZE = 100;

/* ------------------------------------------------------------------ *
 * Env for the API client (client credentials + redirect for refresh).
 * ------------------------------------------------------------------ */

function readClientEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const redirectUri = process.env.XERO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new XeroAuthError(
      "Xero client env missing: set XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI (server-only).",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function toTokenSetParameters(row: XeroTokenRecord): TokenSetParameters {
  return {
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
    expires_at: Math.floor(new Date(row.expiresAt).getTime() / 1000),
    scope: row.scopes,
    token_type: "Bearer",
  };
}

/* ------------------------------------------------------------------ *
 * The gateway
 * ------------------------------------------------------------------ */

export class XeroGateway {
  private _callsUsed = 0;

  private constructor(
    private readonly tenantId: string,
    private readonly client: XeroClient,
    private tokenRow: XeroTokenRecord,
  ) {}

  /**
   * Open a gateway bound to one tenant. Loads stored tokens (AD-10), refreshes
   * them if near expiry, and re-persists the refreshed set.
   */
  static async for(tenantId: string): Promise<XeroGateway> {
    const row = await loadTokenRecord(tenantId);
    if (!row) {
      throw new XeroAuthError(
        `No stored Xero tokens for tenant ${tenantId}. Connect the org first via /api/connect.`,
      );
    }
    const { clientId, clientSecret, redirectUri } = readClientEnv();
    const client = new XeroClient({
      clientId,
      clientSecret,
      redirectUris: [redirectUri],
      scopes: row.scopes.split(/\s+/).filter(Boolean),
    });
    // Discovery/openIdClient is required before refreshToken() can run.
    await client.initialize();
    client.setTokenSet(toTokenSetParameters(row));

    const gateway = new XeroGateway(tenantId, client, row);
    await gateway.ensureFreshToken();
    return gateway;
  }

  /** Number of Xero API calls this gateway instance has spent (for reporting). */
  get apiCallsUsed(): number {
    return this._callsUsed;
  }

  get tenant(): string {
    return this.tenantId;
  }

  private async ensureFreshToken(): Promise<void> {
    const expMs = new Date(this.tokenRow.expiresAt).getTime();
    // Refresh a minute early to avoid mid-flight expiry.
    if (Date.now() < expMs - 60_000) return;

    const refreshed = await this.client.refreshToken();
    const scopes = refreshed.scope ?? this.tokenRow.scopes;
    await saveTokenSet(this.tenantId, this.tokenRow.tenantName, refreshed, scopes);
    this.tokenRow = {
      ...this.tokenRow,
      accessToken: refreshed.access_token ?? this.tokenRow.accessToken,
      refreshToken: refreshed.refresh_token ?? this.tokenRow.refreshToken,
      expiresAt: new Date((refreshed.expires_at ?? 0) * 1000).toISOString(),
      scopes,
    };
  }

  private get api() {
    return this.client.accountingApi;
  }

  /**
   * Wrap a single Xero HTTP call in the rate budget: assert budget, spend one
   * call, then account it (NFR-RateLimit). `essential` writes/identity reads
   * are only blocked at the hard cap; non-essential reads are blocked earlier.
   */
  private async metered<T>(
    essential: boolean,
    fn: () => Promise<{ body: T }>,
  ): Promise<T> {
    await assertBudget(this.tenantId, essential);
    const res = await fn();
    this._callsUsed += 1;
    await bumpDailyCalls(this.tenantId, 1);
    return res.body;
  }

  /* ----------------------------- reads ----------------------------- */

  /** Customers — GET /api.xro/2.0/Contacts (accounting.contacts.read). */
  async getContacts(): Promise<Contact[]> {
    const out: Contact[] = [];
    for (let page = 1; ; page++) {
      const body = await this.metered<Contacts>(true, () =>
        this.api.getContacts(
          this.tenantId,
          undefined, // ifModifiedSince
          undefined, // where
          undefined, // order
          undefined, // iDs
          page,
          undefined, // includeArchived
          undefined, // summaryOnly
          undefined, // searchTerm
          PAGE_SIZE,
        ),
      );
      const batch = body.contacts ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** Revenue — GET /Invoices?where=Type=="ACCREC" (accounting.transactions.read). */
  async getAccrecInvoices(): Promise<Invoice[]> {
    return this.getInvoicesByType("ACCREC");
  }

  /** Supplier costs — GET /Invoices?where=Type=="ACCPAY" (accounting.transactions.read). */
  async getAccpayInvoices(): Promise<Invoice[]> {
    return this.getInvoicesByType("ACCPAY");
  }

  private async getInvoicesByType(type: "ACCREC" | "ACCPAY"): Promise<Invoice[]> {
    const where = `Type=="${type}"`;
    const out: Invoice[] = [];
    for (let page = 1; ; page++) {
      const body = await this.metered<Invoices>(true, () =>
        this.api.getInvoices(
          this.tenantId,
          undefined, // ifModifiedSince
          where,
          undefined, // order
          undefined, // iDs
          undefined, // invoiceNumbers
          undefined, // contactIDs
          undefined, // statuses
          page,
          undefined, // includeArchived
          undefined, // createdByMyApp
          undefined, // unitdp
          undefined, // summaryOnly
          PAGE_SIZE,
        ),
      );
      const batch = body.invoices ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** Uncoded / bank spend — GET /BankTransactions (accounting.transactions.read). */
  async getBankTransactions(): Promise<BankTransaction[]> {
    const out: BankTransaction[] = [];
    for (let page = 1; ; page++) {
      const body = await this.metered<BankTransactions>(true, () =>
        this.api.getBankTransactions(
          this.tenantId,
          undefined, // ifModifiedSince
          undefined, // where
          undefined, // order
          page,
          undefined, // unitdp
          PAGE_SIZE,
        ),
      );
      const batch = body.bankTransactions ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** Settlement reality — GET /Payments (accounting.transactions.read). */
  async getPayments(): Promise<Payment[]> {
    const out: Payment[] = [];
    for (let page = 1; ; page++) {
      const body = await this.metered<Payments>(true, () =>
        this.api.getPayments(
          this.tenantId,
          undefined, // ifModifiedSince
          undefined, // where
          undefined, // order
          page,
          PAGE_SIZE,
        ),
      );
      const batch = body.payments ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** Native cost→customer link — GET /LinkedTransactions (accounting.transactions.read). */
  async getLinkedTransactions(): Promise<LinkedTransaction[]> {
    const out: LinkedTransaction[] = [];
    for (let page = 1; ; page++) {
      const body = await this.metered<LinkedTransactions>(true, () =>
        this.api.getLinkedTransactions(this.tenantId, page),
      );
      const batch = body.linkedTransactions ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** Products / services — GET /Items (accounting.settings.read). Not paged. */
  async getItems(): Promise<Item[]> {
    const body = await this.metered<Items>(true, () =>
      this.api.getItems(this.tenantId),
    );
    return body.items ?? [];
  }

  /** Overhead context — GET /Reports/ProfitAndLoss (accounting.reports.read). */
  async getProfitAndLoss(fromDate?: string, toDate?: string): Promise<ReportWithRows> {
    return this.metered<ReportWithRows>(true, () =>
      this.api.getReportProfitAndLoss(this.tenantId, fromDate, toDate),
    );
  }

  /** Guardrail baseline (stretch) — GET /Quotes (accounting.transactions.read). */
  async getQuotes(): Promise<Quote[]> {
    const out: Quote[] = [];
    for (let page = 1; ; page++) {
      const body = await this.metered<Quotes>(true, () =>
        this.api.getQuotes(
          this.tenantId,
          undefined, // ifModifiedSince
          undefined, // dateFrom
          undefined, // dateTo
          undefined, // expiryDateFrom
          undefined, // expiryDateTo
          undefined, // contactID
          undefined, // status
          page,
        ),
      );
      const batch = body.quotes ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  /* ---------------------------- writes ----------------------------- *
   * Write-back (AD-6) uses these; only editable lines are ever re-tagged
   * and Shared Overhead is never written. The gateway just executes.      */

  /** Create the per-customer tracking category — PUT /TrackingCategories (accounting.settings). */
  async createTrackingCategory(name: string): Promise<TrackingCategory> {
    const body = await this.metered<TrackingCategories>(true, () =>
      this.api.createTrackingCategory(this.tenantId, { name }),
    );
    const category = body.trackingCategories?.[0];
    if (!category) {
      throw new XeroGatewayError(
        "Xero returned no tracking category on create.",
        "XERO_WRITE",
      );
    }
    return category;
  }

  /** Add an option (one per customer) — POST /TrackingCategories/{id}/Options (accounting.settings). */
  async createTrackingOption(
    trackingCategoryID: string,
    name: string,
  ): Promise<TrackingOption> {
    const body = await this.metered<TrackingOptions>(true, () =>
      this.api.createTrackingOptions(this.tenantId, trackingCategoryID, { name }),
    );
    const option = body.options?.[0];
    if (!option) {
      throw new XeroGatewayError(
        "Xero returned no tracking option on create.",
        "XERO_WRITE",
      );
    }
    return option;
  }

  /** Re-tag an editable revenue invoice line — POST /Invoices (accounting.transactions). */
  async retagInvoice(invoiceID: string, invoice: Invoice): Promise<Invoice[]> {
    const body = await this.metered<Invoices>(true, () =>
      this.api.updateInvoice(this.tenantId, invoiceID, { invoices: [invoice] }),
    );
    return body.invoices ?? [];
  }

  /** Re-tag an editable cost bank-transaction line — POST /BankTransactions (accounting.transactions). */
  async retagBankTransaction(
    bankTransactionID: string,
    bankTransaction: BankTransaction,
  ): Promise<BankTransaction[]> {
    const body = await this.metered<BankTransactions>(true, () =>
      this.api.updateBankTransaction(this.tenantId, bankTransactionID, {
        bankTransactions: [bankTransaction],
      }),
    );
    return body.bankTransactions ?? [];
  }
}
