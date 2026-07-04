import {
  XeroClient,
  // Value imports: these classes carry the runtime enum values (TypeEnum,
  // StatusEnum, LineAmountTypes) used when constructing write bodies for the
  // Story 1.4 seed. They double as types in type positions.
  Invoice,
  BankTransaction,
  LineAmountTypes,
  type TokenSet,
  type TokenSetParameters,
  type Contact,
  type Contacts,
  type Invoices,
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
  type Account,
  type Accounts,
  type LineItem,
} from "xero-node";
import { getStore } from "@/lib/store/supabase";

/**
 * The single Xero gateway (AD-2). This is the ONLY module in the app that
 * imports `xero-node` or issues Xero HTTP. It is the sole holder of tokens
 * (AD-10) and the sole place the per-tenant daily rate budget is counted
 * (NFR-RateLimit). Every read/write in the spine's "Xero API Surface" table
 * is exposed here as a typed method; higher layers (ingest, write-back, the
 * demo seed) call these and never touch the SDK.
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
    /** Upstream HTTP status when the failure came from a Xero API call. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "XeroGatewayError";
  }
}

/** No stored tokens / refresh failure / rejected token for a tenant (AD-10). */
export class XeroAuthError extends XeroGatewayError {
  constructor(message: string, status?: number) {
    super(message, "XERO_AUTH", status);
    this.name = "XeroAuthError";
  }
}

/** Daily/near-cap budget refusal or an upstream 429 (NFR-RateLimit). */
export class XeroRateLimitError extends XeroGatewayError {
  constructor(message: string, status?: number) {
    super(message, "XERO_RATE_LIMIT", status);
    this.name = "XeroRateLimitError";
  }
}

/* ------------------------------------------------------------------ *
 * Xero error normalisation.
 * xero-node v18 wraps axios: on any non-2xx it rejects with a JSON STRING
 * (JSON.stringify of `{ response: { statusCode, body, headers }, body }`),
 * and on lower-level failures it may reject with that object or a raw Error.
 * Without this, a 401/429/400 from Xero would surface as an opaque string and
 * lose its status and message. We parse whatever shape arrives, pull the HTTP
 * status and the human Xero message, and raise a typed gateway error so callers
 * (and the { data, error } envelope) get an actionable code + message.
 * ------------------------------------------------------------------ */

interface ParsedXeroError {
  status?: number;
  message?: string;
  retryAfter?: string;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length ? value : undefined;
}

/** Extract a human message from a Xero error body (several shapes exist). */
function messageFromBody(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return pickString(body);
  if (typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;

  // Validation errors: Elements[].ValidationErrors[].Message
  const elements = b.Elements ?? b.elements;
  if (Array.isArray(elements)) {
    const msgs: string[] = [];
    for (const el of elements) {
      const ve = (el as Record<string, unknown>)?.ValidationErrors ?? (el as Record<string, unknown>)?.validationErrors;
      if (Array.isArray(ve)) {
        for (const v of ve) {
          const m = pickString((v as Record<string, unknown>)?.Message ?? (v as Record<string, unknown>)?.message);
          if (m) msgs.push(m);
        }
      }
    }
    if (msgs.length) return msgs.join("; ");
  }

  return (
    pickString(b.Detail ?? b.detail) ??
    pickString(b.Message ?? b.message) ??
    pickString(b.Title ?? b.title) ??
    pickString(b.error_description) ??
    pickString(b.error)
  );
}

function readErrorEnvelope(obj: Record<string, unknown>): ParsedXeroError {
  const response = (obj.response ?? {}) as Record<string, unknown>;
  const headers = (response.headers ?? {}) as Record<string, unknown>;
  const status =
    (typeof response.statusCode === "number" ? response.statusCode : undefined) ??
    (typeof response.status === "number" ? response.status : undefined) ??
    (typeof obj.statusCode === "number" ? (obj.statusCode as number) : undefined);
  const body = response.body ?? response.data ?? obj.body ?? obj.data;
  const retryAfter =
    pickString(headers["retry-after"]) ?? pickString(headers["Retry-After"]);
  return { status, message: messageFromBody(body), retryAfter };
}

function parseXeroError(raw: unknown): ParsedXeroError {
  if (typeof raw === "string") {
    try {
      return readErrorEnvelope(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return { message: raw };
    }
  }
  if (raw && typeof raw === "object") {
    const parsed = readErrorEnvelope(raw as Record<string, unknown>);
    if (parsed.status || parsed.message) return parsed;
    if (raw instanceof Error) return { message: raw.message };
  }
  return {};
}

/** Turn any Xero SDK rejection into a typed gateway error. */
function normalizeXeroError(raw: unknown): XeroGatewayError {
  if (raw instanceof XeroGatewayError) return raw;
  const { status, message, retryAfter } = parseXeroError(raw);
  const detail = message ? `: ${message}` : "";

  if (status === 401) {
    return new XeroAuthError(
      `Xero rejected the access token (401)${detail}. Reconnect the org at /api/connect.`,
      401,
    );
  }
  if (status === 429) {
    const wait = retryAfter ? ` Retry after ${retryAfter}s.` : "";
    return new XeroRateLimitError(
      `Xero rate limit hit (429)${detail}.${wait}`,
      429,
    );
  }
  if (typeof status === "number") {
    return new XeroGatewayError(
      `Xero API error ${status}${detail}.`,
      `XERO_HTTP_${status}`,
      status,
    );
  }
  return new XeroGatewayError(
    `Xero API call failed${detail || ": unknown error"}.`,
    "XERO_API",
  );
}

/* ------------------------------------------------------------------ *
 * Token custody (AD-10) - the gateway is the only holder of tokens.
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
  // openid-client expresses expires_at in whole seconds since epoch.
  const expiresAt = tokenSet.expires_at
    ? new Date(tokenSet.expires_at * 1000).toISOString()
    : new Date(Date.now() + 30 * 60_000).toISOString(); // access tokens live 30m
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
 * Rate budget (NFR-RateLimit) - per-tenant, per-day call counter.
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

/** Xero returns up to 100 records per page for the paged accounting endpoints. */
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
 * Seed helpers (Story 1.4). Plain input/return shapes so the demo seed
 * (`scripts/seed-demo.ts`) can drive Xero writes THROUGH the gateway and
 * never import `xero-node` itself, keeping AD-2 intact. The runtime app
 * pipeline does not use these; they exist only to build the demo org.
 * ------------------------------------------------------------------ */

export interface SeedAccount {
  accountID?: string;
  code?: string;
  name?: string;
  /** Xero AccountType string, e.g. BANK, REVENUE, SALES, EXPENSE, DIRECTCOSTS. */
  type?: string;
  status?: string;
}

export interface SeedContactInput {
  name: string;
  email?: string;
}

export interface SeedLineInput {
  description: string;
  quantity?: number;
  unitAmount: number;
  accountCode: string;
  itemCode?: string;
}

export interface SeedInvoiceInput {
  type: "ACCREC" | "ACCPAY";
  contactID: string;
  reference?: string;
  /** YYYY-MM-DD; defaults handled by Xero if omitted. */
  date?: string;
  dueDate?: string;
  /** DRAFT (fully editable) or AUTHORISED (still editable while unpaid). */
  status?: "DRAFT" | "AUTHORISED";
  lineItems: SeedLineInput[];
}

export interface SeedBankTxnInput {
  type: "SPEND" | "RECEIVE";
  /** Bank account to post against (an account of type BANK). */
  bankAccountID?: string;
  bankAccountCode?: string;
  contactID?: string;
  reference?: string;
  date?: string;
  lineItems: SeedLineInput[];
}

export interface SeedLinkInput {
  /** ACCPAY invoice or SPEND bank transaction carrying the cost. */
  sourceTransactionID: string;
  sourceLineItemID: string;
  /** Customer the cost is billed on to. */
  contactID: string;
  /** ACCREC invoice that is the sale component. */
  targetTransactionID?: string;
  targetLineItemID?: string;
}

/** A created document reduced to just what the seed needs to link/report. */
export interface SeedCreatedDoc {
  id: string;
  reference?: string;
  total: number;
  lineItems: { lineItemID: string; description?: string; lineAmount: number }[];
}

function toSeedLineItems(lines: SeedLineInput[]): LineItem[] {
  return lines.map((l) => ({
    description: l.description,
    quantity: l.quantity ?? 1,
    unitAmount: l.unitAmount,
    accountCode: l.accountCode,
    ...(l.itemCode ? { itemCode: l.itemCode } : {}),
  }));
}

function toSeedCreatedDoc(doc: {
  id?: string;
  reference?: string;
  total?: number;
  lineItems?: LineItem[];
}): SeedCreatedDoc {
  return {
    id: doc.id ?? "",
    reference: doc.reference,
    total: doc.total ?? 0,
    lineItems: (doc.lineItems ?? []).map((li) => ({
      lineItemID: li.lineItemID ?? "",
      description: li.description,
      lineAmount: li.lineAmount ?? 0,
    })),
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

  /**
   * Refresh the access token if it is within a minute of expiry (or always,
   * when `force`). Persists and re-applies the rotated token set. A refresh
   * failure means the stored refresh token is dead (60-day expiry / revoked),
   * so it surfaces as a loud XeroAuthError prompting reconnect.
   */
  private async ensureFreshToken(force = false): Promise<void> {
    const expMs = new Date(this.tokenRow.expiresAt).getTime();
    // Refresh a minute early to avoid mid-flight expiry.
    if (!force && Date.now() < expMs - 60_000) return;

    let refreshed: TokenSet;
    try {
      refreshed = await this.client.refreshToken();
    } catch (err) {
      const detail = err instanceof Error ? `: ${err.message}` : "";
      throw new XeroAuthError(
        `Failed to refresh Xero token for tenant ${this.tenantId}${detail}. ` +
          `The refresh token may have expired (60 days) or been revoked; reconnect at /api/connect.`,
      );
    }
    const scopes = refreshed.scope ?? this.tokenRow.scopes;
    await saveTokenSet(this.tenantId, this.tokenRow.tenantName, refreshed, scopes);
    this.tokenRow = {
      ...this.tokenRow,
      accessToken: refreshed.access_token ?? this.tokenRow.accessToken,
      refreshToken: refreshed.refresh_token ?? this.tokenRow.refreshToken,
      expiresAt: refreshed.expires_at
        ? new Date(refreshed.expires_at * 1000).toISOString()
        : this.tokenRow.expiresAt,
      scopes,
    };
  }

  private get api() {
    return this.client.accountingApi;
  }

  /**
   * Wrap a single Xero HTTP call in the rate budget and error normalisation
   * (NFR-RateLimit; AD-2). `essential` writes/identity reads are only blocked
   * at the hard cap; non-essential reads are blocked earlier. Any SDK rejection
   * is normalised to a typed error; a 401 triggers one forced token refresh and
   * a single retry before giving up (the stored access token may have been
   * invalidated server-side ahead of our clock).
   */
  private async metered<T>(
    essential: boolean,
    fn: () => Promise<{ body: T }>,
  ): Promise<T> {
    return this.meteredAttempt(essential, fn, true);
  }

  private async meteredAttempt<T>(
    essential: boolean,
    fn: () => Promise<{ body: T }>,
    allowAuthRetry: boolean,
  ): Promise<T> {
    await assertBudget(this.tenantId, essential);
    try {
      const res = await fn();
      this._callsUsed += 1;
      await bumpDailyCalls(this.tenantId, 1);
      return res.body;
    } catch (raw) {
      // The attempt still reached Xero and counts toward the daily budget.
      this._callsUsed += 1;
      await bumpDailyCalls(this.tenantId, 1);
      const err = normalizeXeroError(raw);
      if (err instanceof XeroAuthError && err.status === 401 && allowAuthRetry) {
        await this.ensureFreshToken(true);
        return this.meteredAttempt(essential, fn, false);
      }
      throw err;
    }
  }

  /* ----------------------------- reads ----------------------------- */

  /** Customers - GET /api.xro/2.0/Contacts (accounting.contacts.read). */
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

  /** Revenue - GET /Invoices?where=Type=="ACCREC" (accounting.transactions.read). */
  async getAccrecInvoices(): Promise<Invoice[]> {
    return this.getInvoicesByType("ACCREC");
  }

  /** Supplier costs - GET /Invoices?where=Type=="ACCPAY" (accounting.transactions.read). */
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
          undefined, // summaryOnly (false -> line items are returned)
          PAGE_SIZE,
        ),
      );
      const batch = body.invoices ?? [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** Uncoded / bank spend - GET /BankTransactions (accounting.transactions.read). */
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

  /** Settlement reality - GET /Payments (accounting.transactions.read). */
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

  /** Native cost→customer link - GET /LinkedTransactions (accounting.transactions.read). */
  async getLinkedTransactions(): Promise<LinkedTransaction[]> {
    const out: LinkedTransaction[] = [];
    // LinkedTransactions paging is fixed at 100/page (no pageSize param).
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

  /** Products / services - GET /Items (accounting.settings.read). Not paged. */
  async getItems(): Promise<Item[]> {
    const body = await this.metered<Items>(true, () =>
      this.api.getItems(this.tenantId),
    );
    return body.items ?? [];
  }

  /** Overhead context - GET /Reports/ProfitAndLoss (accounting.reports.read). */
  async getProfitAndLoss(fromDate?: string, toDate?: string): Promise<ReportWithRows> {
    return this.metered<ReportWithRows>(true, () =>
      this.api.getReportProfitAndLoss(this.tenantId, fromDate, toDate),
    );
  }

  /** Guardrail baseline (stretch) - GET /Quotes (accounting.transactions.read). */
  async getQuotes(): Promise<Quote[]> {
    const out: Quote[] = [];
    // Quotes paging is fixed at 100/page (no pageSize param).
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

  /** Chart of accounts - GET /Accounts (accounting.settings.read). Used by the seed. */
  async getAccounts(where?: string): Promise<SeedAccount[]> {
    const body = await this.metered<Accounts>(true, () =>
      this.api.getAccounts(this.tenantId, undefined, where),
    );
    return (body.accounts ?? []).map((a: Account) => ({
      accountID: a.accountID,
      code: a.code,
      name: a.name,
      type: a.type != null ? String(a.type) : undefined,
      status: a.status != null ? String(a.status) : undefined,
    }));
  }

  /* ---------------------------- writes ----------------------------- *
   * Write-back (AD-6) uses these; only editable lines are ever re-tagged
   * and Shared Overhead is never written. The gateway just executes.      */

  /** Create the per-customer tracking category - PUT /TrackingCategories (accounting.settings). */
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

  /** Add an option (one per customer) - POST /TrackingCategories/{id}/Options (accounting.settings). */
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

  /** Re-tag an editable revenue invoice line - POST /Invoices (accounting.transactions). */
  async retagInvoice(invoiceID: string, invoice: Invoice): Promise<Invoice[]> {
    const body = await this.metered<Invoices>(true, () =>
      this.api.updateInvoice(this.tenantId, invoiceID, { invoices: [invoice] }),
    );
    return body.invoices ?? [];
  }

  /** Re-tag an editable cost bank-transaction line - POST /BankTransactions (accounting.transactions). */
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

  /* ------------------------- seed cleanup -------------------------- *
   * Story 1.4 idempotency: remove docs a previous seed run created so a
   * re-run produces a clean, non-duplicated demo ledger.                  */

  /** All invoices, both ACCREC and ACCPAY (seed cleanup). */
  async getAllInvoices(): Promise<Invoice[]> {
    const [accrec, accpay] = await Promise.all([
      this.getInvoicesByType("ACCREC"),
      this.getInvoicesByType("ACCPAY"),
    ]);
    return [...accrec, ...accpay];
  }

  /** Void an AUTHORISED invoice, or delete a DRAFT one (seed cleanup). */
  async voidOrDeleteInvoice(invoiceID: string, draft: boolean): Promise<void> {
    await this.metered<Invoices>(true, () =>
      this.api.updateInvoice(this.tenantId, invoiceID, {
        invoices: [
          { status: draft ? Invoice.StatusEnum.DELETED : Invoice.StatusEnum.VOIDED },
        ],
      }),
    );
  }

  /** Delete a bank transaction (seed cleanup). */
  async deleteBankTransaction(bankTransactionID: string): Promise<void> {
    await this.metered<BankTransactions>(true, () =>
      this.api.updateBankTransaction(this.tenantId, bankTransactionID, {
        bankTransactions: [
          { status: BankTransaction.StatusEnum.DELETED } as BankTransaction,
        ],
      }),
    );
  }

  /** Delete a linked transaction so its source invoice can be voided (seed cleanup). */
  async deleteLinkedTransaction(linkedTransactionID: string): Promise<void> {
    await this.metered<unknown>(true, () =>
      this.api.deleteLinkedTransaction(this.tenantId, linkedTransactionID) as Promise<{
        body: unknown;
      }>,
    );
  }

  /* -------------------------- seed writes -------------------------- *
   * Story 1.4 only. These create the demo org through the gateway so the
   * seed script never touches xero-node (AD-2).                            */

  /** Create a contact - POST /Contacts (accounting.contacts). */
  async createContact(input: SeedContactInput): Promise<{ contactID: string; name: string }> {
    const body = await this.metered<Contacts>(true, () =>
      this.api.createContacts(this.tenantId, {
        contacts: [{ name: input.name, ...(input.email ? { emailAddress: input.email } : {}) }],
      }),
    );
    const contact = body.contacts?.[0];
    if (!contact?.contactID) {
      throw new XeroGatewayError("Xero returned no contact on create.", "XERO_SEED");
    }
    return { contactID: contact.contactID, name: contact.name ?? input.name };
  }

  /**
   * Create a BANK account when the org has none (seed only) - PUT /Accounts
   * (accounting.settings). Fresh trial orgs ship a default chart of accounts but
   * no bank account, so the seed needs to add one to post bank transactions.
   */
  async createBankAccount(name: string, code: string): Promise<SeedAccount> {
    const account: Account = {
      name,
      code,
      type: "BANK" as unknown as Account["type"],
      bankAccountNumber: `SD${code}00000000`,
      bankAccountType: "BANK" as unknown as Account["bankAccountType"],
    };
    const body = await this.metered<Accounts>(true, () =>
      this.api.createAccount(this.tenantId, account),
    );
    const created = body.accounts?.[0];
    if (!created?.accountID) {
      throw new XeroGatewayError("Xero returned no account on create.", "XERO_SEED");
    }
    return {
      accountID: created.accountID,
      code: created.code,
      name: created.name,
      type: created.type != null ? String(created.type) : undefined,
      status: created.status != null ? String(created.status) : undefined,
    };
  }

  /** Create an ACCREC/ACCPAY invoice - POST /Invoices (accounting.transactions). */
  async createInvoice(input: SeedInvoiceInput): Promise<SeedCreatedDoc> {
    const invoice: Invoice = {
      type:
        input.type === "ACCREC" ? Invoice.TypeEnum.ACCREC : Invoice.TypeEnum.ACCPAY,
      contact: { contactID: input.contactID },
      lineAmountTypes: LineAmountTypes.NoTax,
      lineItems: toSeedLineItems(input.lineItems),
      ...(input.reference ? { reference: input.reference } : {}),
      ...(input.date ? { date: input.date } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      status:
        input.status === "DRAFT"
          ? Invoice.StatusEnum.DRAFT
          : Invoice.StatusEnum.AUTHORISED,
    };
    const body = await this.metered<Invoices>(true, () =>
      this.api.createInvoices(this.tenantId, { invoices: [invoice] }),
    );
    const created = body.invoices?.[0];
    if (!created?.invoiceID) {
      throw new XeroGatewayError("Xero returned no invoice on create.", "XERO_SEED");
    }
    return toSeedCreatedDoc({
      id: created.invoiceID,
      reference: created.reference,
      total: created.total,
      lineItems: created.lineItems,
    });
  }

  /** Create a SPEND/RECEIVE bank transaction - POST /BankTransactions (accounting.transactions). */
  async createBankTransaction(input: SeedBankTxnInput): Promise<SeedCreatedDoc> {
    if (!input.bankAccountID && !input.bankAccountCode) {
      throw new XeroGatewayError(
        "createBankTransaction needs a bankAccountID or bankAccountCode (an account of type BANK).",
        "XERO_SEED",
      );
    }
    const txn: BankTransaction = {
      type:
        input.type === "SPEND"
          ? BankTransaction.TypeEnum.SPEND
          : BankTransaction.TypeEnum.RECEIVE,
      bankAccount: input.bankAccountID
        ? { accountID: input.bankAccountID }
        : { code: input.bankAccountCode },
      lineAmountTypes: LineAmountTypes.NoTax,
      lineItems: toSeedLineItems(input.lineItems),
      isReconciled: false, // stays editable/re-taggable (AD-6)
      ...(input.contactID ? { contact: { contactID: input.contactID } } : {}),
      ...(input.reference ? { reference: input.reference } : {}),
      ...(input.date ? { date: input.date } : {}),
    };
    const body = await this.metered<BankTransactions>(true, () =>
      this.api.createBankTransactions(this.tenantId, { bankTransactions: [txn] }),
    );
    const created = body.bankTransactions?.[0];
    if (!created?.bankTransactionID) {
      throw new XeroGatewayError(
        "Xero returned no bank transaction on create.",
        "XERO_SEED",
      );
    }
    return toSeedCreatedDoc({
      id: created.bankTransactionID,
      reference: created.reference,
      total: created.total,
      lineItems: created.lineItems,
    });
  }

  /** Create an item - POST /Items (accounting.settings). */
  async createItem(code: string, name: string): Promise<{ itemID: string; code: string }> {
    const body = await this.metered<Items>(true, () =>
      this.api.createItems(this.tenantId, { items: [{ code, name }] }),
    );
    const item = body.items?.[0];
    if (!item?.itemID) {
      throw new XeroGatewayError("Xero returned no item on create.", "XERO_SEED");
    }
    return { itemID: item.itemID, code: item.code ?? code };
  }

  /**
   * Create a LinkedTransaction (billable expense) - PUT /LinkedTransactions
   * (accounting.transactions). This is the High-confidence native cost→customer
   * signal (AD-5): a source purchase line linked to a customer and optionally to
   * a target ACCREC invoice line.
   */
  async createLinkedTransaction(
    input: SeedLinkInput,
  ): Promise<{ linkedTransactionID: string }> {
    const body = await this.metered<LinkedTransactions>(true, () =>
      this.api.createLinkedTransaction(this.tenantId, {
        sourceTransactionID: input.sourceTransactionID,
        sourceLineItemID: input.sourceLineItemID,
        contactID: input.contactID,
        ...(input.targetTransactionID
          ? { targetTransactionID: input.targetTransactionID }
          : {}),
        ...(input.targetLineItemID
          ? { targetLineItemID: input.targetLineItemID }
          : {}),
      }),
    );
    const link = body.linkedTransactions?.[0];
    if (!link?.linkedTransactionID) {
      throw new XeroGatewayError(
        "Xero returned no linked transaction on create.",
        "XERO_SEED",
      );
    }
    return { linkedTransactionID: link.linkedTransactionID };
  }
}
