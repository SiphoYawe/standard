import type {
  Confidence,
  CustomerMargin,
  Verdict,
  VerdictKpis,
} from "@/lib/contracts/verdict";

/**
 * The monthly digest payload (FR-13). It is a *presentation projection* of the
 * Verdict, derived entirely from fields the attribution engine already computed
 * (AD-4). No new attribution or margin logic lives here — this only ranks, filters,
 * and phrases what the Verdict already states, so Make can email it verbatim
 * (AD-7: Make holds no business logic; the API shapes the payload).
 */

export type DigestMoneyLoser = {
  customerId: string;
  customerName: string;
  revenue: number;
  trueMargin: number;
  currency: string;
  confidence: Confidence;
  /** Jargon-free reason, straight from the Verdict (FR-8). */
  why: string;
  /** Deterministic call-to-action phrased from this customer's own figures. */
  recommendedAction: string;
  /** True if a send-ready repricing email is attached to the Verdict (FR-9). */
  draftReady: boolean;
};

export type DigestTopPerformer = {
  customerName: string;
  trueMargin: number;
  currency: string;
};

export type DigestPayload = {
  version: 1;
  tenantId: string;
  tenantName: string;
  snapshotId: string;
  generatedAt: string;
  /** Human month label derived from generatedAt, e.g. "July 2026". */
  period: string;
  baseCurrency: string;
  /** Ready-to-use email subject line. */
  subject: string;
  /** One-line preview / lead sentence. */
  headline: string;
  kpis: VerdictKpis;
  /** Money-losers, worst first (the Verdict already ranks them ascending). */
  moneyLosers: DigestMoneyLoser[];
  /** The single strongest account, for a positive close. Null if none. */
  topPerformer: DigestTopPerformer | null;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Month + year in UTC, e.g. "July 2026". Deterministic (no locale drift). */
function periodLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Latest";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Whole-unit amount with thousands separators, e.g. 3200 -> "3,200". */
function grouped(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function money(amount: number, currency: string): string {
  return `${currency} ${grouped(amount)}`;
}

function recommendedAction(customer: CustomerMargin): string {
  const loss = money(customer.trueMargin, customer.currency);
  const revenue = money(customer.revenue, customer.currency);
  if (customer.draftedFix && customer.draftedFix.trim().length > 0) {
    return `Send the ready-to-go repricing email — ${customer.customerName} is ${loss} underwater on ${revenue} of revenue.`;
  }
  return `Reprice or renegotiate ${customer.customerName}: ${loss} underwater on ${revenue} of revenue.`;
}

function buildHeadline(
  tenantName: string,
  moneyLosers: DigestMoneyLoser[],
): string {
  if (moneyLosers.length === 0) {
    return `${tenantName}: every account is profitable this period. No money-losers found.`;
  }
  const worst = moneyLosers[0];
  const count = moneyLosers.length;
  const accountWord = count === 1 ? "account is" : "accounts are";
  return `${tenantName}: ${count} ${accountWord} costing you money. Worst is ${worst.customerName} at ${money(worst.trueMargin, worst.currency)}.`;
}

function buildSubject(kpis: VerdictKpis, period: string, baseCurrency: string): string {
  const loserWord = kpis.moneyLoserCount === 1 ? "money-loser" : "money-losers";
  return `Standard — ${period}: ${kpis.moneyLoserCount} ${loserWord}, ${money(kpis.hiddenLossesUncovered, baseCurrency)} in hidden losses uncovered`;
}

function pickTopPerformer(customers: CustomerMargin[]): DigestTopPerformer | null {
  let best: CustomerMargin | null = null;
  for (const customer of customers) {
    if (!best || customer.trueMargin > best.trueMargin) {
      best = customer;
    }
  }
  if (!best) return null;
  return {
    customerName: best.customerName,
    trueMargin: best.trueMargin,
    currency: best.currency,
  };
}

/** Projects a validated Verdict into the compact digest payload (FR-13). */
export function buildDigest(verdict: Verdict): DigestPayload {
  const period = periodLabel(verdict.generatedAt);

  // Verdict.customers is already ranked ascending by trueMargin (money-losers
  // first), so filtering preserves the "worst first" order — no re-sorting.
  const moneyLosers: DigestMoneyLoser[] = verdict.customers
    .filter((customer) => customer.isMoneyLoser)
    .map((customer) => ({
      customerId: customer.customerId,
      customerName: customer.customerName,
      revenue: customer.revenue,
      trueMargin: customer.trueMargin,
      currency: customer.currency,
      confidence: customer.confidence,
      why: customer.why,
      recommendedAction: recommendedAction(customer),
      draftReady: Boolean(customer.draftedFix && customer.draftedFix.trim().length > 0),
    }));

  return {
    version: 1,
    tenantId: verdict.tenantId,
    tenantName: verdict.tenantName,
    snapshotId: verdict.snapshotId,
    generatedAt: verdict.generatedAt,
    period,
    baseCurrency: verdict.baseCurrency,
    subject: buildSubject(verdict.kpis, period, verdict.baseCurrency),
    headline: buildHeadline(verdict.tenantName, moneyLosers),
    kpis: verdict.kpis,
    moneyLosers,
    topPerformer: pickTopPerformer(verdict.customers),
  };
}
