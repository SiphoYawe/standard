import { z } from "zod";

/**
 * The normalized Ledger snapshot (AD-3, AD-11): the boundary between Track A
 * (Xero ingest, producer) and Track B (attribution, consumer). Track A writes
 * this shape into Supabase; the pipeline reads it and never re-hits Xero.
 *
 * Amounts are decimal numbers in the org base currency (convention: round at
 * display only). Xero ids are stored verbatim as source keys.
 */

export const LedgerContact = z.object({
  contactID: z.string(),
  name: z.string(),
  isCustomer: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
});
export type LedgerContact = z.infer<typeof LedgerContact>;

export const LedgerLineItem = z.object({
  lineItemID: z.string().optional(),
  description: z.string().optional(),
  lineAmount: z.number(),
  accountCode: z.string().optional(),
  itemCode: z.string().optional(),
});
export type LedgerLineItem = z.infer<typeof LedgerLineItem>;

/** Covers Invoices (ACCREC + ACCPAY) and BankTransactions uniformly. */
export const LedgerTxn = z.object({
  /** "ACCREC" | "ACCPAY" | "SPEND" | "RECEIVE" */
  type: z.string(),
  /** Xero object id (InvoiceID / BankTransactionID). */
  id: z.string(),
  /** Which Xero endpoint this came from, for write-back routing. */
  source: z.enum(["Invoice", "BankTransaction"]),
  contactID: z.string().optional(),
  contactName: z.string().optional(),
  reference: z.string().optional(),
  date: z.string().optional(),
  total: z.number(),
  currency: z.string(),
  /** "PAID" | "AUTHORISED" | "DRAFT" | reconciled state — drives editability. */
  status: z.string().optional(),
  /** True if unpaid/unreconciled and therefore re-taggable (AD-6). */
  editable: z.boolean().default(false),
  lineItems: z.array(LedgerLineItem).default([]),
});
export type LedgerTxn = z.infer<typeof LedgerTxn>;

/** Native cost→customer link (highest-confidence signal, AD-5). */
export const LedgerLink = z.object({
  linkedTransactionID: z.string(),
  /** The source document the cost sits on (a Bill/SpendMoney). */
  sourceTransactionID: z.string(),
  sourceLineItemID: z.string().optional(),
  /** The customer the cost is billed to. */
  contactID: z.string().optional(),
  amount: z.number().optional(),
});
export type LedgerLink = z.infer<typeof LedgerLink>;

export const LedgerItem = z.object({
  itemID: z.string(),
  code: z.string(),
  name: z.string().optional(),
});
export type LedgerItem = z.infer<typeof LedgerItem>;

export const LedgerPayment = z.object({
  paymentID: z.string(),
  invoiceID: z.string().optional(),
  amount: z.number(),
  date: z.string().optional(),
});
export type LedgerPayment = z.infer<typeof LedgerPayment>;

/** The whole normalized snapshot. */
export const LedgerSnapshot = z.object({
  tenantId: z.string(),
  snapshotId: z.string(),
  baseCurrency: z.string(),
  createdAt: z.string(),
  contacts: z.array(LedgerContact),
  /** ACCREC (revenue) + ACCPAY (costs) invoices, plus bank transactions. */
  transactions: z.array(LedgerTxn),
  linkedTransactions: z.array(LedgerLink).default([]),
  payments: z.array(LedgerPayment).default([]),
  items: z.array(LedgerItem).default([]),
  /** Raw P&L report rows for the overhead pool (attribution reads what it needs). */
  profitAndLoss: z.unknown().optional(),
});
export type LedgerSnapshot = z.infer<typeof LedgerSnapshot>;
