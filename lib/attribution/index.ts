import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LedgerSnapshot, LedgerTxn } from "../contracts/ledger";
import type { Allocation, SourceRef } from "../contracts/verdict";
import { confidenceForSignal } from "./confidence";

/**
 * Attribution engine (FR-3, FR-4; AD-5, AD-9).
 *
 * Turns a LedgerSnapshot into Allocation[]:
 *   (a) direct costs via native LinkedTransactions (High) + rule-based
 *       reference matching (Medium),
 *   (b) an LLM proposal pass for leftover unmatched costs — the LLM proposes
 *       ties but NEVER sets confidence (that is confidence.ts's job, AD-5);
 *       its structured response is zod-validated before use (AD-9). A
 *       deterministic no-LLM fallback pools the leftovers so the pipeline runs
 *       with ANTHROPIC_API_KEY absent,
 *   (c) shared overhead split by revenue-share (Story 2.2), kind="overhead".
 *
 * The single Claude call is server-side, schema-constrained and single-purpose.
 */

export interface CustomerRef {
  customerId: string;
  customerName: string;
  revenue: number;
}

export interface AttributionOptions {
  /** Force the LLM proposal pass on/off. Defaults to: is an API key available? */
  useLlm?: boolean;
  /** Server-side only (never NEXT_PUBLIC_). Falls back to ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Overrides ANTHROPIC_MODEL / the default model. */
  model?: string;
}

export interface AttributionResult {
  allocations: Allocation[];
  customers: CustomerRef[];
  baseCurrency: string;
  /** True if the LLM proposal pass actually ran (for provenance/telemetry). */
  usedLlm: boolean;
}

const DEFAULT_MODEL = "claude-opus-4-8";

// --- small helpers -----------------------------------------------------------

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

function money(n: number, currency: string): string {
  const symbols: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };
  const sym = symbols[currency];
  const body = Math.round(Math.abs(n)).toLocaleString("en-GB");
  const sign = n < 0 ? "-" : "";
  return sym ? `${sign}${sym}${body}` : `${sign}${body} ${currency}`;
}

const isRevenue = (t: LedgerTxn): boolean => t.type === "ACCREC" || t.type === "RECEIVE";
const isCost = (t: LedgerTxn): boolean => t.type === "ACCPAY" || t.type === "SPEND";

function firstLineDesc(t: LedgerTxn): string | undefined {
  for (const li of t.lineItems) if (li.description) return li.description;
  return undefined;
}
function firstLineId(t: LedgerTxn): string | undefined {
  for (const li of t.lineItems) if (li.lineItemID) return li.lineItemID;
  return undefined;
}
function lineAmountFor(t: LedgerTxn, lineItemID?: string): number | undefined {
  if (!lineItemID) return undefined;
  return t.lineItems.find((l) => l.lineItemID === lineItemID)?.lineAmount;
}
function descFor(t: LedgerTxn, lineItemID?: string): string | undefined {
  if (lineItemID) {
    const li = t.lineItems.find((l) => l.lineItemID === lineItemID);
    if (li?.description) return li.description;
  }
  return firstLineDesc(t) ?? t.reference;
}

/** Distinctive lowercased token for a customer name (first word if long enough). */
function customerToken(name: string): string {
  const first = name.split(/\s+/)[0] ?? name;
  return (first.length >= 4 ? first : name).toLowerCase();
}

// --- direct-cost builder -----------------------------------------------------

function makeDirect(args: {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  signal: "linked-transaction" | "reference-match" | "llm-inference";
  rationale: string;
  source: SourceRef;
}): Allocation {
  return {
    id: args.id,
    customerId: args.customerId,
    kind: "direct",
    amount: round2(args.amount),
    currency: args.currency,
    confidence: confidenceForSignal(args.signal),
    rationale: args.rationale,
    sources: [args.source],
  };
}

/** Rule-based (Medium) match: does a cost's reference/description name a customer? */
function matchCustomerByReference(
  txn: LedgerTxn,
  customers: CustomerRef[],
): { customerId: string; customerName: string; field: "reference" | "description" } | null {
  const parts: string[] = [];
  if (txn.reference) parts.push(txn.reference);
  for (const li of txn.lineItems) if (li.description) parts.push(li.description);
  const hay = parts.join(" | ").toLowerCase();
  if (!hay) return null;

  const hits = customers.filter((c) => hay.includes(customerToken(c.customerName)));
  if (hits.length !== 1) return null; // 0 = overhead, >1 = ambiguous -> leave for LLM/pool

  const c = hits[0];
  const inRef = Boolean(txn.reference && txn.reference.toLowerCase().includes(customerToken(c.customerName)));
  return { customerId: c.customerId, customerName: c.customerName, field: inRef ? "reference" : "description" };
}

// --- LLM proposal pass (AD-9) ------------------------------------------------

const ProposalResponse = z.object({
  proposals: z.array(
    z.object({
      costId: z.string(),
      customerId: z.string().nullable(),
      reason: z.string().optional(),
    }),
  ),
});
type Proposal = z.infer<typeof ProposalResponse>["proposals"][number];

function extractJson(text: string): string {
  const t = text.trim();
  const objStart = t.indexOf("{");
  const objEnd = t.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) return t.slice(objStart, objEnd + 1);
  return t;
}

/**
 * One server-side, schema-validated Claude call (AD-9). The model proposes a
 * customer id (or null for shared overhead) per unattributed cost. It is told
 * explicitly not to state confidence — confidence.ts assigns Low to every tie.
 */
async function proposeTies(
  untied: LedgerTxn[],
  customers: CustomerRef[],
  opts: { apiKey?: string; model?: string },
): Promise<Proposal[]> {
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : undefined);
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const costLines = untied.map((t) => ({
    costId: t.id,
    description: firstLineDesc(t) ?? "",
    reference: t.reference ?? "",
    supplier: t.contactName ?? "",
    amount: t.total,
    date: t.date ?? "",
  }));
  const custLines = customers.map((c) => ({ customerId: c.customerId, name: c.customerName, revenue: c.revenue }));

  const system =
    "You are a bookkeeping assistant for a trades business. For each unattributed supplier cost, propose which customer's job it most plausibly belongs to, or leave it as shared overhead. Never invent customers. Never state a confidence level — that is assigned elsewhere. Respond with ONLY minified JSON, no prose, no markdown.";
  const user =
    `Customers:\n${JSON.stringify(custLines)}\n\n` +
    `Unattributed costs:\n${JSON.stringify(costLines)}\n\n` +
    `For EACH cost return {"costId","customerId","reason"} where customerId is one of ` +
    `the customer ids above if the cost clearly belongs to that customer's job, or null ` +
    `if it is shared overhead (vehicles, insurance, software, general fuel, accountancy). ` +
    `Return {"proposals":[...]} and nothing else.`;

  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  let text = "";
  for (const block of res.content) if (block.type === "text") text += block.text;

  // zod-validate before anything enters the pipeline (AD-9).
  return ProposalResponse.parse(JSON.parse(extractJson(text))).proposals;
}

// --- the engine --------------------------------------------------------------

export async function attribute(
  snapshot: LedgerSnapshot,
  opts: AttributionOptions = {},
): Promise<AttributionResult> {
  const baseCurrency = snapshot.baseCurrency;
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const useLlm = opts.useLlm ?? Boolean(apiKey);

  // Customers + revenue (from ACCREC / RECEIVE).
  const customerContacts = snapshot.contacts.filter((c) => c.isCustomer);
  const customerIds = new Set(customerContacts.map((c) => c.contactID));
  const revenueByCustomer = new Map<string, number>();
  for (const t of snapshot.transactions) {
    if (!isRevenue(t) || !t.contactID || !customerIds.has(t.contactID)) continue;
    revenueByCustomer.set(t.contactID, (revenueByCustomer.get(t.contactID) ?? 0) + t.total);
  }
  const customers: CustomerRef[] = customerContacts.map((c) => ({
    customerId: c.contactID,
    customerName: c.name,
    revenue: round2(revenueByCustomer.get(c.contactID) ?? 0),
  }));
  const customerById = new Map(customers.map((c) => [c.customerId, c]));

  const costTxns = snapshot.transactions.filter(isCost);
  const txnById = new Map(snapshot.transactions.map((t) => [t.id, t]));
  const consumed = new Set<string>();
  const allocations: Allocation[] = [];

  // (a1) Direct costs — High confidence via native LinkedTransactions.
  for (const link of snapshot.linkedTransactions) {
    const src = txnById.get(link.sourceTransactionID);
    if (!src) continue;
    const customerId = link.contactID;
    if (!customerId || !customerIds.has(customerId)) continue;

    const amount = link.amount ?? lineAmountFor(src, link.sourceLineItemID) ?? src.total;
    allocations.push(
      makeDirect({
        id: `alloc-lt-${link.linkedTransactionID}`,
        customerId,
        amount,
        currency: src.currency,
        signal: "linked-transaction",
        rationale: "Cost carried to this customer by a native Xero linked transaction.",
        source: {
          type: "LinkedTransaction",
          xeroId: link.linkedTransactionID,
          lineItemId: link.sourceLineItemID ?? firstLineId(src),
          description: descFor(src, link.sourceLineItemID),
          amount: round2(amount),
          editable: src.editable,
        },
      }),
    );
    consumed.add(src.id);
  }

  // (a2) Direct costs — Medium confidence via rule-based reference matching.
  for (const txn of costTxns) {
    if (consumed.has(txn.id)) continue;
    const match = matchCustomerByReference(txn, customers);
    if (!match) continue;

    allocations.push(
      makeDirect({
        id: `alloc-ref-${txn.id}`,
        customerId: match.customerId,
        amount: txn.total,
        currency: txn.currency,
        signal: "reference-match",
        rationale: `Supplier ${txn.contactName ?? "bill"} names ${match.customerName} in its ${match.field}.`,
        source: {
          type: txn.source,
          xeroId: txn.id,
          lineItemId: firstLineId(txn),
          description: firstLineDesc(txn) ?? txn.reference,
          amount: round2(txn.total),
          editable: txn.editable,
        },
      }),
    );
    consumed.add(txn.id);
  }

  // (b) Leftover unmatched costs -> LLM proposal (Low), else pool.
  const untied = costTxns.filter((t) => !consumed.has(t.id));
  let usedLlm = false;
  const pooled: LedgerTxn[] = [];

  if (useLlm && untied.length > 0) {
    try {
      const proposals = await proposeTies(untied, customers, { apiKey, model: opts.model });
      usedLlm = true;
      const byId = new Map(untied.map((t) => [t.id, t]));
      const tied = new Set<string>();
      for (const p of proposals) {
        if (!p.customerId || !customerIds.has(p.customerId)) continue;
        const txn = byId.get(p.costId);
        if (!txn || tied.has(txn.id)) continue;
        const cust = customerById.get(p.customerId);
        if (!cust) continue;
        allocations.push(
          makeDirect({
            id: `alloc-llm-${txn.id}`,
            customerId: p.customerId,
            amount: txn.total,
            currency: txn.currency,
            signal: "llm-inference",
            rationale: `Proposed tie to ${cust.customerName} from transaction context — inferred, needs confirmation.`,
            source: {
              type: txn.source,
              xeroId: txn.id,
              lineItemId: firstLineId(txn),
              description: firstLineDesc(txn) ?? txn.reference,
              amount: round2(txn.total),
              editable: txn.editable,
            },
          }),
        );
        tied.add(txn.id);
      }
      for (const t of untied) if (!tied.has(t.id)) pooled.push(t);
    } catch {
      // Any LLM/validation failure degrades safely to the deterministic path.
      pooled.push(...untied);
    }
  } else {
    // Deterministic no-LLM fallback: everything unmatched becomes shared overhead.
    pooled.push(...untied);
  }

  // (c) Shared overhead split by revenue-share (Story 2.2), kind="overhead".
  const totalRevenue = sum(customers.map((c) => c.revenue));
  const poolTotal = round2(sum(pooled.map((t) => Math.abs(t.total))));
  if (poolTotal > 0 && totalRevenue > 0) {
    for (const c of customers) {
      if (c.revenue <= 0) continue;
      const frac = c.revenue / totalRevenue;
      const share = round2(poolTotal * frac);
      if (share <= 0) continue;

      // Trace each customer's share back to the real pooled transactions,
      // pro-rated. Never editable — shared overhead is never written back (AD-6).
      const sources: SourceRef[] = pooled.map((t) => ({
        type: t.source,
        xeroId: t.id,
        lineItemId: firstLineId(t),
        description: firstLineDesc(t) ?? t.reference ?? "Shared overhead",
        amount: round2(Math.abs(t.total) * frac),
        editable: false,
      }));

      allocations.push({
        id: `oh-${c.customerId}`,
        customerId: c.customerId,
        kind: "overhead",
        amount: share,
        currency: baseCurrency,
        confidence: confidenceForSignal("overhead-driver"),
        driver: "revenue-share",
        rationale: `${(frac * 100).toFixed(1)}% revenue-share of ${money(poolTotal, baseCurrency)} shared overhead (vehicles, insurance, software, uncoded spend).`,
        sources,
      });
    }
  }

  return { allocations, customers, baseCurrency, usedLlm };
}
