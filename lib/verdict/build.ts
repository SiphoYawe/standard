import type { LedgerSnapshot } from "../contracts/ledger";
import { Verdict } from "../contracts/verdict";
import type { Allocation, CustomerMargin } from "../contracts/verdict";
import { attribute, type AttributionOptions } from "../attribution";
import { aggregateConfidence, lowConfidenceCount } from "../attribution/confidence";
import { draftRepricingEmail } from "../attribution/draft";

/**
 * Verdict builder (FR-5, FR-6, FR-8, AD-4). Assembles the single producer
 * contract: per-customer true margins, aggregate confidence + low-confidence
 * count, a plain-English `why`, the drafted fix for money-losers, KPIs, and the
 * customer list ranked ascending by trueMargin (money-losers first).
 *
 * The output MUST pass Verdict.parse(...); this function returns exactly that.
 */

export interface BuildOptions extends AttributionOptions {
  /** Human-readable org name for the Verdict header (snapshot has only tenantId). */
  tenantName?: string;
  /** ISO 8601 timestamp; defaults to now. */
  generatedAt?: string;
  /** trueMargin strictly below this flags a money-loser. Defaults to 0. */
  moneyLoserThreshold?: number;
  /** Draft a repricing email for each money-loser. Defaults to true. */
  draftFixes?: boolean;
  /** Owner name used to sign drafted emails. */
  ownerName?: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

function money(n: number, currency: string): string {
  const symbols: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };
  const sym = symbols[currency];
  const body = Math.round(Math.abs(n)).toLocaleString("en-GB");
  const sign = n < 0 ? "-" : "";
  return sym ? `${sign}${sym}${body}` : `${sign}${body} ${currency}`;
}

/** The largest single direct cost — the account's main cost driver, for `why`. */
function topDirectDriver(allocs: Allocation[]): { desc: string; amount: number } | null {
  const direct = allocs.filter((a) => a.kind === "direct");
  if (direct.length === 0) return null;
  let best = direct[0];
  for (const a of direct) if (a.amount > best.amount) best = a;
  return { desc: best.sources[0]?.description ?? "job costs", amount: best.amount };
}

/** 1-3 sentence, jargon-free reason this customer wins or loses (FR-8). */
function buildWhy(
  name: string,
  revenue: number,
  cost: number,
  trueMargin: number,
  currency: string,
  top: { desc: string; amount: number } | null,
  isLoser: boolean,
): string {
  if (isLoser) {
    let s =
      `${name}'s ${money(revenue, currency)} of invoices is outweighed by ${money(cost, currency)} ` +
      `of true cost — direct job costs plus a fair share of overhead — leaving a ${money(Math.abs(trueMargin), currency)} loss.`;
    if (top) s += ` The biggest single cost is ${top.desc.toLowerCase()} at ${money(top.amount, currency)}.`;
    return s;
  }
  return (
    `${name} is a genuine contributor: ${money(revenue, currency)} of revenue against ` +
    `${money(cost, currency)} of true cost leaves ${money(trueMargin, currency)} of margin.`
  );
}

export async function buildVerdict(
  snapshot: LedgerSnapshot,
  opts: BuildOptions = {},
): Promise<Verdict> {
  const threshold = opts.moneyLoserThreshold ?? 0;
  const draftFixes = opts.draftFixes ?? true;

  const { allocations, customers, baseCurrency } = await attribute(snapshot, opts);

  const margins: CustomerMargin[] = [];
  for (const c of customers) {
    const allocs = allocations.filter((a) => a.customerId === c.customerId);
    const directCost = round2(sum(allocs.filter((a) => a.kind === "direct").map((a) => a.amount)));
    const overheadCost = round2(sum(allocs.filter((a) => a.kind === "overhead").map((a) => a.amount)));
    const ownerTimeCost = round2(sum(allocs.filter((a) => a.kind === "owner_time").map((a) => a.amount)));
    const revenue = round2(c.revenue);
    const trueMargin = round2(revenue - directCost - overheadCost - ownerTimeCost);
    const isMoneyLoser = trueMargin < threshold;

    margins.push({
      customerId: c.customerId,
      customerName: c.customerName,
      revenue,
      directCost,
      overheadCost,
      ownerTimeCost,
      trueMargin,
      currency: baseCurrency,
      isMoneyLoser,
      confidence: aggregateConfidence(allocs),
      lowConfidenceCount: lowConfidenceCount(allocs),
      why: buildWhy(
        c.customerName,
        revenue,
        round2(directCost + overheadCost + ownerTimeCost),
        trueMargin,
        baseCurrency,
        topDirectDriver(allocs),
        isMoneyLoser,
      ),
      allocations: allocs,
    });
  }

  // Drafted fix for each money-loser (FR-9).
  if (draftFixes) {
    for (const m of margins) {
      if (!m.isMoneyLoser) continue;
      m.draftedFix = await draftRepricingEmail(m, {
        useLlm: opts.useLlm,
        apiKey: opts.apiKey,
        model: opts.model,
        ownerName: opts.ownerName,
      });
    }
  }

  // Ranked ascending by trueMargin — money-losers first (FR-8).
  margins.sort((a, b) => a.trueMargin - b.trueMargin);

  const losers = margins.filter((m) => m.isMoneyLoser);
  const verdict = {
    version: 1,
    tenantId: snapshot.tenantId,
    tenantName: opts.tenantName ?? snapshot.tenantId,
    snapshotId: snapshot.snapshotId,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    baseCurrency,
    kpis: {
      hiddenLossesUncovered: round2(sum(losers.map((m) => -m.trueMargin))),
      moneyLoserCount: losers.length,
      blendedTrueMargin: round2(sum(margins.map((m) => m.trueMargin))),
      revenueAtRisk: round2(sum(losers.map((m) => m.revenue))),
    },
    customers: margins,
  };

  // The output is the contract — validate before returning (AD-4).
  return Verdict.parse(verdict);
}
