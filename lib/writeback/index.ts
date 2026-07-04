import {
  parseVerdict,
  type Allocation,
  type Confidence,
  type SourceRef,
  type Verdict,
} from "@/lib/contracts/verdict";
import {
  LedgerSnapshot,
  type LedgerLineItem,
  type LedgerLink,
  type LedgerTxn,
} from "@/lib/contracts/ledger";
import { getStore } from "@/lib/store/supabase";
import { XeroGateway } from "@/lib/xero/gateway";

/**
 * Write-back stage (FR-11, AD-6): the honest re-tag model.
 *
 * The dashboard shows the truth; write-back pushes that truth back into Xero as
 * a per-customer Tracking Category so the owner's native "P&L by tracking
 * category" report tells the same story. AD-6 pins the rules this module obeys:
 *
 *   1. Writes go only through the single gateway (AD-2). This module never
 *      imports xero-node; the Xero payload shapes are derived structurally from
 *      the gateway's own method signatures (see the type aliases below), so the
 *      "one module touches Xero" rule holds.
 *   2. Only editable (unpaid / unreconciled) lines are re-tagged. Editability is
 *      taken from the persisted snapshot (txn.editable), cross-checked against
 *      the Verdict source ref. Paid / reconciled lines are reported as skipped.
 *   3. Only Confirmed allocations are written: High / Medium confidence auto
 *      confirm, Low confidence must be named in allocationIds. Shared overhead is
 *      NEVER written back (it is one pooled cost split across customers, it
 *      cannot be tagged to a single option). Owner-time is an estimate, not a
 *      ledger line, so it is never written either.
 *   4. Every apply is preceded by a computed dry-run diff (previewWriteback),
 *      which is pure and performs no writes.
 *
 * Two kinds of line are re-tagged: direct-cost lines (from the Verdict's
 * `direct` allocations) and revenue lines (each customer's editable ACCREC
 * invoices, taken straight from the snapshot). Together they let the native
 * per-tracking-category P&L show both sides of each customer's true margin.
 */

/** The one tracking category this app owns in the connected org. */
export const TRACKING_CATEGORY_NAME = "Standard Customer";

/** Typed, non-bare failures so the API route can map a code to an HTTP status. */
export class WritebackError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "WritebackError";
  }
}

/* ------------------------------------------------------------------ *
 * Public shapes
 * ------------------------------------------------------------------ */

export type LineKind = "direct-cost" | "revenue";
export type SkipKind = LineKind | "overhead" | "owner-time";

/** One editable Xero line that would be (or was) tagged to a customer option. */
export interface RetagEntry {
  /** Which gateway write routes this line: Invoice or BankTransaction. */
  sourceType: "Invoice" | "BankTransaction";
  /** The Xero object id to re-tag (InvoiceID / BankTransactionID). */
  xeroId: string;
  /** The specific line to tag, or undefined to tag the whole document. */
  lineItemId?: string;
  description: string;
  amount: number;
  customerId: string;
  customerName: string;
  lineKind: LineKind;
  /** Present for cost lines (the confidence of the underlying allocation). */
  confidence?: Confidence;
  /** Present for cost lines (the source allocation id). */
  allocationId?: string;
}

/** A line (or allocation) that will NOT be written, with a plain-English why. */
export interface SkippedEntry {
  customerId: string;
  customerName?: string;
  sourceType?: string;
  xeroId?: string;
  lineItemId?: string;
  description?: string;
  amount?: number;
  lineKind: SkipKind;
  allocationId?: string;
  reason: string;
}

export interface WritebackCounts {
  /** Distinct customers with at least one line to re-tag. */
  customers: number;
  toRetag: number;
  skipped: number;
  directCosts: number;
  revenue: number;
  overheadExcluded: number;
  ownerTimeExcluded: number;
  nonEditableSkipped: number;
  lowConfidenceSkipped: number;
  unresolvedSkipped: number;
}

export interface WritebackPreview {
  trackingCategoryName: string;
  tenantId: string;
  snapshotId: string;
  toRetag: RetagEntry[];
  skipped: SkippedEntry[];
  counts: WritebackCounts;
}

export type WrittenEntry = RetagEntry;

export interface WritebackApplyCounts extends WritebackCounts {
  written: number;
  writeFailed: number;
  categoryCreated: boolean;
  categoryReused: boolean;
  optionsCreated: number;
}

export interface WritebackResult {
  trackingCategoryName: string;
  tenantId: string;
  snapshotId: string;
  written: WrittenEntry[];
  skipped: SkippedEntry[];
  counts: WritebackApplyCounts;
}

/* ------------------------------------------------------------------ *
 * Xero payload types, derived from the gateway (no xero-node import, AD-2)
 * ------------------------------------------------------------------ */

type InvoiceArg = Parameters<XeroGateway["retagInvoice"]>[1];
type BankTxnArg = Parameters<XeroGateway["retagBankTransaction"]>[1];
type LineItemArg = NonNullable<InvoiceArg["lineItems"]>[number];
type TrackingArg = NonNullable<LineItemArg["tracking"]>[number];

/* ------------------------------------------------------------------ *
 * Store loading (AD-11): the Verdict names its snapshot; we load both.
 * ------------------------------------------------------------------ */

function supabaseWired(): boolean {
  return (
    Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

function assertWired(): void {
  if (supabaseWired()) return;
  throw new WritebackError(
    "Supabase is not wired: set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and " +
      "SUPABASE_SERVICE_ROLE_KEY. Write-back reads the stored Verdict and Ledger " +
      "snapshot and cannot run against the demo mock.",
    "SUPABASE_NOT_WIRED",
  );
}

/** Latest stored Verdict for a tenant, or the newest of any tenant if omitted. */
async function loadLatestVerdict(tenantId?: string): Promise<Verdict | null> {
  const store = getStore();
  let query = store
    .from("verdicts")
    .select("verdict")
    .order("created_at", { ascending: false })
    .limit(1);
  if (tenantId) query = query.eq("tenant_id", tenantId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new WritebackError(`Verdict read failed: ${error.message}`, "STORE_READ");
  }
  if (!data) return null;
  return parseVerdict((data as { verdict: unknown }).verdict);
}

/** The exact snapshot the Verdict was computed from (AD-11). */
async function loadSnapshotById(snapshotId: string): Promise<LedgerSnapshot | null> {
  const store = getStore();
  const { data, error } = await store
    .from("snapshots")
    .select("ledger")
    .eq("snapshot_id", snapshotId)
    .maybeSingle();
  if (error) {
    throw new WritebackError(`Snapshot read failed: ${error.message}`, "STORE_READ");
  }
  if (!data) return null;
  return LedgerSnapshot.parse((data as { ledger: unknown }).ledger);
}

async function loadVerdictAndSnapshot(
  tenantId?: string,
): Promise<{ verdict: Verdict; snapshot: LedgerSnapshot }> {
  assertWired();
  const verdict = await loadLatestVerdict(tenantId);
  if (!verdict) {
    const scope = tenantId ? ` for tenant ${tenantId}` : "";
    throw new WritebackError(
      `No stored verdict${scope}. Run POST /api/refresh then the attribution pipeline first.`,
      "NO_VERDICT",
    );
  }
  const snapshot = await loadSnapshotById(verdict.snapshotId);
  if (!snapshot) {
    throw new WritebackError(
      `No snapshot ${verdict.snapshotId} for tenant ${verdict.tenantId}. The Verdict references a snapshot that is no longer stored.`,
      "NO_SNAPSHOT",
    );
  }
  return { verdict, snapshot };
}

/* ------------------------------------------------------------------ *
 * Planning: turn a Verdict + snapshot into a re-tag plan (dry run).
 * ------------------------------------------------------------------ */

const isRevenue = (t: LedgerTxn): boolean =>
  t.type === "ACCREC" || t.type === "RECEIVE";

function firstLineDesc(t: LedgerTxn): string | undefined {
  for (const li of t.lineItems) if (li.description) return li.description;
  return undefined;
}

/** Confirmed = High/Medium confidence, or explicitly named in allocationIds. */
function isConfirmed(alloc: Allocation, allocationIds?: string[]): boolean {
  if (allocationIds && allocationIds.includes(alloc.id)) return true;
  return alloc.confidence === "High" || alloc.confidence === "Medium";
}

interface ResolvedTarget {
  txn: LedgerTxn;
  lineItemId?: string;
}

/**
 * Resolve an allocation source to the concrete, re-taggable Xero transaction.
 * A LinkedTransaction source carries the linked-transaction id, not the cost
 * document id, so it is dereferenced through the snapshot's link table to the
 * underlying Bill / SpendMoney. Invoice / BankTransaction sources are the txn.
 */
function resolveCostTarget(
  source: SourceRef,
  txnById: Map<string, LedgerTxn>,
  linkById: Map<string, LedgerLink>,
): ResolvedTarget | null {
  if (source.type === "LinkedTransaction") {
    const link = linkById.get(source.xeroId);
    if (!link) return null;
    const txn = txnById.get(link.sourceTransactionID);
    if (!txn) return null;
    return { txn, lineItemId: source.lineItemId ?? link.sourceLineItemID };
  }
  const txn = txnById.get(source.xeroId);
  if (!txn) return null;
  return { txn, lineItemId: source.lineItemId };
}

interface WritebackPlan {
  toRetag: RetagEntry[];
  skipped: SkippedEntry[];
  counts: WritebackCounts;
}

function planWriteback(
  verdict: Verdict,
  snapshot: LedgerSnapshot,
  allocationIds?: string[],
): WritebackPlan {
  const txnById = new Map(snapshot.transactions.map((t) => [t.id, t]));
  const linkById = new Map(
    snapshot.linkedTransactions.map((l) => [l.linkedTransactionID, l]),
  );
  const customerNameById = new Map(
    verdict.customers.map((c) => [c.customerId, c.customerName]),
  );

  const toRetag: RetagEntry[] = [];
  const skipped: SkippedEntry[] = [];
  const seen = new Set<string>();

  let overheadExcluded = 0;
  let ownerTimeExcluded = 0;
  let nonEditableSkipped = 0;
  let lowConfidenceSkipped = 0;
  let unresolvedSkipped = 0;

  const pushRetag = (entry: RetagEntry): void => {
    const key = `${entry.xeroId}::${entry.lineItemId ?? "*"}::${entry.customerId}`;
    if (seen.has(key)) return;
    seen.add(key);
    toRetag.push(entry);
  };

  // --- direct-cost lines, from the Verdict's confirmed `direct` allocations ---
  for (const customer of verdict.customers) {
    for (const alloc of customer.allocations) {
      if (alloc.kind === "overhead") {
        overheadExcluded += 1;
        skipped.push({
          customerId: alloc.customerId,
          customerName: customer.customerName,
          amount: alloc.amount,
          lineKind: "overhead",
          allocationId: alloc.id,
          reason:
            "Shared overhead is one pooled cost split across customers by " +
            `${alloc.driver ?? "a driver"}; it cannot be re-tagged to a single customer (AD-6).`,
        });
        continue;
      }
      if (alloc.kind === "owner_time") {
        ownerTimeExcluded += 1;
        skipped.push({
          customerId: alloc.customerId,
          customerName: customer.customerName,
          amount: alloc.amount,
          lineKind: "owner-time",
          allocationId: alloc.id,
          reason: "Owner-time is an owner estimate, not a Xero ledger line, so it is never written back.",
        });
        continue;
      }

      // kind === "direct"
      if (!isConfirmed(alloc, allocationIds)) {
        lowConfidenceSkipped += 1;
        skipped.push({
          customerId: alloc.customerId,
          customerName: customer.customerName,
          amount: alloc.amount,
          lineKind: "direct-cost",
          allocationId: alloc.id,
          reason: "Low-confidence allocation is unconfirmed; pass its id in allocationIds to include it.",
        });
        continue;
      }

      const source = alloc.sources[0];
      const target = resolveCostTarget(source, txnById, linkById);
      if (!target) {
        unresolvedSkipped += 1;
        skipped.push({
          customerId: alloc.customerId,
          customerName: customer.customerName,
          sourceType: source.type,
          xeroId: source.xeroId,
          lineItemId: source.lineItemId,
          description: source.description,
          amount: alloc.amount,
          lineKind: "direct-cost",
          allocationId: alloc.id,
          reason: "Could not resolve the underlying Xero cost transaction in the snapshot.",
        });
        continue;
      }

      // Editability is authoritative from the snapshot (AD-6).
      if (!target.txn.editable) {
        nonEditableSkipped += 1;
        skipped.push({
          customerId: alloc.customerId,
          customerName: customer.customerName,
          sourceType: target.txn.source,
          xeroId: target.txn.id,
          lineItemId: target.lineItemId,
          description: source.description ?? firstLineDesc(target.txn),
          amount: alloc.amount,
          lineKind: "direct-cost",
          allocationId: alloc.id,
          reason: `Source ${target.txn.source.toLowerCase()} is paid/reconciled (status ${target.txn.status ?? "unknown"}); not editable.`,
        });
        continue;
      }

      pushRetag({
        sourceType: target.txn.source,
        xeroId: target.txn.id,
        lineItemId: target.lineItemId,
        description: source.description ?? firstLineDesc(target.txn) ?? "Direct cost",
        amount: alloc.amount,
        customerId: alloc.customerId,
        customerName: customer.customerName,
        lineKind: "direct-cost",
        confidence: alloc.confidence,
        allocationId: alloc.id,
      });
    }
  }

  // --- revenue lines: each known customer's editable ACCREC / RECEIVE txns ---
  for (const txn of snapshot.transactions) {
    if (!isRevenue(txn) || !txn.contactID) continue;
    const customerName = customerNameById.get(txn.contactID);
    if (!customerName) continue; // not a customer the Verdict knows about

    if (!txn.editable) {
      nonEditableSkipped += 1;
      skipped.push({
        customerId: txn.contactID,
        customerName,
        sourceType: txn.source,
        xeroId: txn.id,
        description: firstLineDesc(txn) ?? txn.reference,
        amount: txn.total,
        lineKind: "revenue",
        reason: `Revenue ${txn.source.toLowerCase()} is paid/reconciled (status ${txn.status ?? "unknown"}); not editable.`,
      });
      continue;
    }

    pushRetag({
      sourceType: txn.source,
      xeroId: txn.id,
      lineItemId: undefined, // tag every line of a revenue document to its customer
      description: firstLineDesc(txn) ?? txn.reference ?? "Revenue",
      amount: txn.total,
      customerId: txn.contactID,
      customerName,
      lineKind: "revenue",
    });
  }

  const distinctCustomers = new Set(toRetag.map((e) => e.customerId));
  const counts: WritebackCounts = {
    customers: distinctCustomers.size,
    toRetag: toRetag.length,
    skipped: skipped.length,
    directCosts: toRetag.filter((e) => e.lineKind === "direct-cost").length,
    revenue: toRetag.filter((e) => e.lineKind === "revenue").length,
    overheadExcluded,
    ownerTimeExcluded,
    nonEditableSkipped,
    lowConfidenceSkipped,
    unresolvedSkipped,
  };

  return { toRetag, skipped, counts };
}

/* ------------------------------------------------------------------ *
 * previewWriteback: pure dry-run diff (no writes).
 * ------------------------------------------------------------------ */

export async function previewWriteback(
  tenantId?: string,
  allocationIds?: string[],
): Promise<WritebackPreview> {
  const { verdict, snapshot } = await loadVerdictAndSnapshot(tenantId);
  const plan = planWriteback(verdict, snapshot, allocationIds);
  return {
    trackingCategoryName: TRACKING_CATEGORY_NAME,
    tenantId: verdict.tenantId,
    snapshotId: verdict.snapshotId,
    toRetag: plan.toRetag,
    skipped: plan.skipped,
    counts: plan.counts,
  };
}

/* ------------------------------------------------------------------ *
 * applyWriteback: create/reuse the category + options, then re-tag lines.
 * ------------------------------------------------------------------ */

/** Rebuild a Xero line item from the snapshot, adding tracking when tagged. */
function toLineItemPayload(li: LedgerLineItem, tracking?: TrackingArg): LineItemArg {
  const out: LineItemArg = {
    lineItemID: li.lineItemID,
    description: li.description,
    lineAmount: li.lineAmount,
    accountCode: li.accountCode,
    itemCode: li.itemCode,
  };
  if (tracking) out.tracking = [tracking];
  return out;
}

function toSkipped(entry: RetagEntry, reason: string): SkippedEntry {
  return {
    customerId: entry.customerId,
    customerName: entry.customerName,
    sourceType: entry.sourceType,
    xeroId: entry.xeroId,
    lineItemId: entry.lineItemId,
    description: entry.description,
    amount: entry.amount,
    lineKind: entry.lineKind,
    allocationId: entry.allocationId,
    reason,
  };
}

export async function applyWriteback(
  tenantId?: string,
  allocationIds?: string[],
): Promise<WritebackResult> {
  const { verdict, snapshot } = await loadVerdictAndSnapshot(tenantId);
  const plan = planWriteback(verdict, snapshot, allocationIds);

  const written: WrittenEntry[] = [];
  const skipped: SkippedEntry[] = [...plan.skipped];
  let writeFailed = 0;

  // Nothing editable and confirmed to write: still record the (empty) run.
  if (plan.toRetag.length === 0) {
    await recordRun(verdict.tenantId, verdict.snapshotId, written, skipped);
    return buildResult(verdict, plan, written, skipped, {
      writeFailed,
      categoryCreated: false,
      categoryReused: false,
      optionsCreated: 0,
    });
  }

  const gateway = await XeroGateway.for(verdict.tenantId);

  // Ensure the tracking category exists. The gateway exposes no read for
  // existing categories, so on a re-run the create fails (already exists) and we
  // reuse it by name: Xero resolves tracking by category+option name when the
  // ids are absent. Idempotent within a run; best-effort reuse across runs.
  let categoryId: string | undefined;
  let categoryCreated = false;
  let categoryReused = false;
  try {
    const category = await gateway.createTrackingCategory(TRACKING_CATEGORY_NAME);
    categoryId = category.trackingCategoryID ?? undefined;
    categoryCreated = true;
  } catch {
    categoryReused = true;
  }

  // One option per customer. Created only when we hold the category id (first
  // run). On reuse we tag by name and let Xero match the existing option.
  const distinctCustomers = new Map<string, string>();
  for (const entry of plan.toRetag) {
    if (!distinctCustomers.has(entry.customerId)) {
      distinctCustomers.set(entry.customerId, entry.customerName);
    }
  }
  const optionIdByCustomer = new Map<string, string>();
  let optionsCreated = 0;
  if (categoryId) {
    for (const [customerId, customerName] of distinctCustomers) {
      try {
        const option = await gateway.createTrackingOption(categoryId, customerName);
        if (option.trackingOptionID) {
          optionIdByCustomer.set(customerId, option.trackingOptionID);
        }
        optionsCreated += 1;
      } catch {
        // Option already exists; it will be matched by name at re-tag time.
      }
    }
  }

  const trackingFor = (customerId: string, customerName: string): TrackingArg => {
    const tracking: TrackingArg = {
      name: TRACKING_CATEGORY_NAME,
      option: customerName,
    };
    if (categoryId) tracking.trackingCategoryID = categoryId;
    const optionId = optionIdByCustomer.get(customerId);
    if (optionId) tracking.trackingOptionID = optionId;
    return tracking;
  };

  // Group by transaction so each Xero document is written exactly once (fewer
  // calls, kinder to the rate budget). A cost document may have different lines
  // going to different customers; a revenue document tags all lines to one.
  const txnById = new Map(snapshot.transactions.map((t) => [t.id, t]));
  const groups = new Map<string, RetagEntry[]>();
  for (const entry of plan.toRetag) {
    const arr = groups.get(entry.xeroId) ?? [];
    arr.push(entry);
    groups.set(entry.xeroId, arr);
  }

  for (const [xeroId, entries] of groups) {
    const txn = txnById.get(xeroId);
    if (!txn) {
      for (const entry of entries) {
        skipped.push(toSkipped(entry, "Transaction missing from snapshot at write time."));
      }
      writeFailed += entries.length;
      continue;
    }

    const lineCustomer = new Map<string, { customerId: string; customerName: string }>();
    let wholeTxnCustomer: { customerId: string; customerName: string } | undefined;
    for (const entry of entries) {
      const target = { customerId: entry.customerId, customerName: entry.customerName };
      if (entry.lineItemId) lineCustomer.set(entry.lineItemId, target);
      else wholeTxnCustomer = target;
    }

    const lineItems: LineItemArg[] = txn.lineItems.map((li) => {
      const byLine = li.lineItemID ? lineCustomer.get(li.lineItemID) : undefined;
      const customer = byLine ?? wholeTxnCustomer;
      return toLineItemPayload(
        li,
        customer ? trackingFor(customer.customerId, customer.customerName) : undefined,
      );
    });

    try {
      if (txn.source === "Invoice") {
        await gateway.retagInvoice(txn.id, { invoiceID: txn.id, lineItems });
      } else {
        // BankTransaction requires type + bankAccount in the model; bankAccount
        // is not carried in the snapshot, so the payload is best-effort and cast
        // through the gateway's own parameter type (no xero-node import). A Xero
        // rejection is caught below and reported honestly in `skipped`.
        const payload = {
          bankTransactionID: txn.id,
          type: txn.type,
          lineItems,
        } as unknown as BankTxnArg;
        await gateway.retagBankTransaction(txn.id, payload);
      }
      for (const entry of entries) written.push(entry);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Xero write failed.";
      for (const entry of entries) skipped.push(toSkipped(entry, reason));
      writeFailed += entries.length;
    }
  }

  await recordRun(verdict.tenantId, verdict.snapshotId, written, skipped);

  return buildResult(verdict, plan, written, skipped, {
    writeFailed,
    categoryCreated,
    categoryReused,
    optionsCreated,
  });
}

/* ------------------------------------------------------------------ *
 * Helpers: audit record + result assembly.
 * ------------------------------------------------------------------ */

async function recordRun(
  tenantId: string,
  snapshotId: string,
  written: WrittenEntry[],
  skipped: SkippedEntry[],
): Promise<void> {
  // Audit trail (writeback_runs). Best-effort: the Xero writes already happened,
  // so a failure to persist the audit row must not fail the response.
  try {
    const store = getStore();
    const { error } = await store.from("writeback_runs").insert({
      tenant_id: tenantId,
      snapshot_id: snapshotId,
      written,
      skipped,
    });
    if (error) {
      console.warn(`writeback: failed to record run: ${error.message}`);
    }
  } catch (err) {
    console.warn(
      `writeback: failed to record run: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function buildResult(
  verdict: Verdict,
  plan: WritebackPlan,
  written: WrittenEntry[],
  skipped: SkippedEntry[],
  extra: {
    writeFailed: number;
    categoryCreated: boolean;
    categoryReused: boolean;
    optionsCreated: number;
  },
): WritebackResult {
  const distinctCustomers = new Set(written.map((e) => e.customerId));
  const counts: WritebackApplyCounts = {
    ...plan.counts,
    customers: distinctCustomers.size,
    skipped: skipped.length,
    written: written.length,
    writeFailed: extra.writeFailed,
    categoryCreated: extra.categoryCreated,
    categoryReused: extra.categoryReused,
    optionsCreated: extra.optionsCreated,
  };
  return {
    trackingCategoryName: TRACKING_CATEGORY_NAME,
    tenantId: verdict.tenantId,
    snapshotId: verdict.snapshotId,
    written,
    skipped,
    counts,
  };
}
