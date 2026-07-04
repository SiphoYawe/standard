import { randomUUID } from "node:crypto";
import { LedgerSnapshot } from "@/lib/contracts/ledger";
import { XeroGateway } from "@/lib/xero/gateway";

/**
 * Ingest → normalized Ledger snapshot (AD-3, AD-11). Pulls the full Ledger
 * through the single gateway (AD-2) and maps Xero's model objects into the
 * frozen `LedgerSnapshot` contract — the boundary Track B (attribution) reads.
 *
 * This module deliberately does NOT import `xero-node`: it only touches the
 * gateway, and the Xero model types flow through inferred from the gateway's
 * return signatures. Enum-valued fields (Type/Status/CurrencyCode) are coerced
 * to plain strings; each transaction is marked `editable` from its paid /
 * reconciled state so write-back (AD-6) only ever re-tags unpaid/unreconciled
 * lines. Amounts are stored as-is (decimal); rounding happens at display only.
 *
 * Note: the gateway also exposes `getQuotes()` for the stretch Quote-guardrail
 * scenario (FR-14), but Quotes have no field in the LedgerSnapshot contract, so
 * the standard refresh does not fetch them (saves rate budget, AD-3).
 */

export interface BuildSnapshotOptions {
  tenantName?: string;
  /** Override the generated snapshot id (else a fresh UUID). */
  snapshotId?: string;
  /** Optional P&L window (YYYY-MM-DD); Xero defaults to the current month. */
  fromDate?: string;
  toDate?: string;
}

/** null/undefined-safe string coercion for Xero enum-ish fields. */
function str(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

/** Editable when unpaid (invoices) or unreconciled (bank txns) — AD-6. */
const OPEN_INVOICE_STATUSES = ["DRAFT", "SUBMITTED", "AUTHORISED"];
const DEAD_STATUSES = ["DELETED", "VOIDED"];

export async function buildSnapshot(
  gateway: XeroGateway,
  opts: BuildSnapshotOptions = {},
): Promise<LedgerSnapshot> {
  // Sequential on purpose: stays comfortably under Xero's 5-concurrent limit
  // (NFR-RateLimit); demo-sized ledgers keep this well within NFR-Perf (~30s).
  const contacts = await gateway.getContacts();
  const accrecInvoices = await gateway.getAccrecInvoices();
  const accpayInvoices = await gateway.getAccpayInvoices();
  const bankTransactions = await gateway.getBankTransactions();
  const payments = await gateway.getPayments();
  const linkedTransactions = await gateway.getLinkedTransactions();
  const items = await gateway.getItems();
  const profitAndLoss = await gateway.getProfitAndLoss(opts.fromDate, opts.toDate);

  // Base currency: first currency seen on real ledger data, else env, else USD.
  const baseCurrency =
    str(accrecInvoices.find((i) => i.currencyCode != null)?.currencyCode) ??
    str(accpayInvoices.find((i) => i.currencyCode != null)?.currencyCode) ??
    str(bankTransactions.find((b) => b.currencyCode != null)?.currencyCode) ??
    process.env.XERO_BASE_CURRENCY ??
    "USD";

  const invoiceTxns = [...accrecInvoices, ...accpayInvoices].map((inv) => {
    const statusStr = str(inv.status) ?? "";
    const editable =
      OPEN_INVOICE_STATUSES.includes(statusStr) && (inv.amountPaid ?? 0) === 0;
    return {
      type: str(inv.type) ?? "",
      id: inv.invoiceID ?? "",
      source: "Invoice" as const,
      contactID: inv.contact?.contactID,
      contactName: inv.contact?.name,
      reference: inv.reference,
      date: str(inv.date),
      total: inv.total ?? 0,
      currency: str(inv.currencyCode) ?? baseCurrency,
      status: statusStr || undefined,
      editable,
      lineItems: (inv.lineItems ?? []).map((li) => ({
        lineItemID: li.lineItemID,
        description: li.description,
        lineAmount: li.lineAmount ?? 0,
        accountCode: li.accountCode,
        itemCode: li.itemCode,
      })),
    };
  });

  const bankTxns = bankTransactions.map((bt) => {
    const rawStatus = str(bt.status) ?? "";
    const editable = !bt.isReconciled && !DEAD_STATUSES.includes(rawStatus);
    return {
      type: str(bt.type) ?? "",
      id: bt.bankTransactionID ?? "",
      source: "BankTransaction" as const,
      contactID: bt.contact?.contactID,
      contactName: bt.contact?.name,
      reference: bt.reference,
      date: str(bt.date),
      total: bt.total ?? 0,
      currency: str(bt.currencyCode) ?? baseCurrency,
      status: bt.isReconciled ? "RECONCILED" : rawStatus || undefined,
      editable,
      lineItems: (bt.lineItems ?? []).map((li) => ({
        lineItemID: li.lineItemID,
        description: li.description,
        lineAmount: li.lineAmount ?? 0,
        accountCode: li.accountCode,
        itemCode: li.itemCode,
      })),
    };
  });

  const snapshot = {
    tenantId: gateway.tenant,
    snapshotId: opts.snapshotId ?? randomUUID(),
    baseCurrency,
    createdAt: new Date().toISOString(),
    contacts: contacts.map((c) => ({
      contactID: c.contactID ?? "",
      name: c.name ?? "",
      isCustomer: c.isCustomer ?? false,
      isSupplier: c.isSupplier ?? false,
    })),
    transactions: [...invoiceTxns, ...bankTxns],
    linkedTransactions: linkedTransactions.map((lt) => ({
      linkedTransactionID: lt.linkedTransactionID ?? "",
      sourceTransactionID: lt.sourceTransactionID ?? "",
      sourceLineItemID: lt.sourceLineItemID,
      contactID: lt.contactID,
    })),
    payments: payments.map((p) => ({
      paymentID: p.paymentID ?? "",
      invoiceID: p.invoice?.invoiceID,
      amount: p.amount ?? 0,
      date: str(p.date),
    })),
    items: items.map((it) => ({
      itemID: it.itemID ?? "",
      code: it.code,
      name: it.name,
    })),
    profitAndLoss,
  };

  // Guarantee contract conformance before it is persisted / handed downstream.
  return LedgerSnapshot.parse(snapshot);
}
