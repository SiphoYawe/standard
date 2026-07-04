import { z } from "zod";

/**
 * The Verdict contract (AD-4). This schema is the single producer/consumer
 * contract between the attribution engine (producer) and the dashboard + Make
 * digest (consumers). No consumer reaches past this shape into Xero or engine
 * internals. Confidence is set by rule, never by the LLM (AD-5).
 */

export const Confidence = z.enum(["High", "Medium", "Low"]);
export type Confidence = z.infer<typeof Confidence>;

export const AllocationKind = z.enum(["direct", "overhead", "owner_time"]);
export type AllocationKind = z.infer<typeof AllocationKind>;

/** A single Xero source record an allocation traces back to (FR-6). */
export const SourceRef = z.object({
  /** Xero object type, e.g. "Invoice", "BankTransaction", "LinkedTransaction". */
  type: z.string(),
  /** Xero object id, stored verbatim. */
  xeroId: z.string(),
  /** Line item id where the cost/revenue sits, if applicable. */
  lineItemId: z.string().optional(),
  description: z.string().optional(),
  amount: z.number(),
  /** True if the line is unpaid/unreconciled and therefore re-taggable (AD-6). */
  editable: z.boolean().default(false),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** One assignment of a cost (or share of one) to a customer (AD-5, AD-11). */
export const Allocation = z.object({
  id: z.string(),
  customerId: z.string(),
  kind: AllocationKind,
  amount: z.number(),
  currency: z.string(),
  confidence: Confidence,
  /** For overhead: the driver used (e.g. "revenue-share"). */
  driver: z.string().optional(),
  /** Plain-language note on why this cost was tied to this customer. */
  rationale: z.string().optional(),
  sources: z.array(SourceRef).min(1),
});
export type Allocation = z.infer<typeof Allocation>;

/** Per-customer true margin, auditable to source (FR-5, FR-6, FR-8). */
export const CustomerMargin = z.object({
  customerId: z.string(),
  customerName: z.string(),
  revenue: z.number(),
  directCost: z.number(),
  overheadCost: z.number(),
  ownerTimeCost: z.number().default(0),
  trueMargin: z.number(),
  currency: z.string(),
  isMoneyLoser: z.boolean(),
  /** Aggregate confidence for this customer's figure (AD-5). */
  confidence: Confidence,
  lowConfidenceCount: z.number().int().nonnegative(),
  /** 1-3 sentence jargon-free reason this customer wins/loses (FR-8). */
  why: z.string(),
  allocations: z.array(Allocation),
  /** Editable, send-ready repricing email for a money-loser (FR-9). */
  draftedFix: z.string().optional(),
});
export type CustomerMargin = z.infer<typeof CustomerMargin>;

/** Dashboard KPI row (UX-DR2). */
export const VerdictKpis = z.object({
  hiddenLossesUncovered: z.number(),
  moneyLoserCount: z.number().int().nonnegative(),
  blendedStandard: z.number(),
  revenueAtRisk: z.number(),
});
export type VerdictKpis = z.infer<typeof VerdictKpis>;

/** The whole Verdict — the contract (AD-4). */
export const Verdict = z.object({
  version: z.literal(1),
  tenantId: z.string(),
  tenantName: z.string(),
  snapshotId: z.string(),
  generatedAt: z.string(), // ISO 8601 (UTC)
  baseCurrency: z.string(),
  kpis: VerdictKpis,
  /** Customers ranked ascending by trueMargin (money-losers first). */
  customers: z.array(CustomerMargin),
});
export type Verdict = z.infer<typeof Verdict>;

export function parseVerdict(input: unknown): Verdict {
  return Verdict.parse(input);
}
