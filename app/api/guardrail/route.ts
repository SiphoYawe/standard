import { NextResponse } from "next/server";

import type { CustomerMargin, Verdict } from "@/lib/contracts/verdict";
import { resolveVerdict } from "../_lib/verdict-source";

/**
 * POST /api/guardrail - the quote guardrail (FR-14, Story 6.2).
 *
 * Turns hindsight into foresight: before you send a Quote, check the named
 * customer against the latest stored Verdict. If they are a known money-loser,
 * or their historical true-margin rate implies this quote would lose money, the
 * endpoint returns a warning citing that customer's real margin history plus a
 * suggested minimum price to break even.
 *
 * This is a READ-ONLY check (AD-7 "Make orchestrates, code computes"): it reads
 * the Verdict the pipeline already stored, never recomputes and never touches
 * Xero. When no Supabase pipeline is wired it falls back to the validated mock
 * (via resolveVerdict), so it is demoable immediately.
 *
 * Body: { tenantId?, customerId?, customerName?, quoteAmount? }
 * Returns: { data: { warning, severity, message, customer? }, error }
 *
 * A missing verdict or an unmatched customer is NOT an error: it degrades to a
 * graceful non-warning (warning:false, severity:"none") so a live quote flow is
 * never blocked by the absence of history.
 */

// xero-node is never touched here, but keep the run server-side and uncached so
// every quote is checked against the freshest stored verdict.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = "high" | "medium" | "low" | "none";

/** Compact margin history returned to the caller when a customer is matched. */
interface GuardrailCustomer {
  customerId: string;
  customerName: string;
  currency: string;
  revenue: number;
  trueMargin: number;
  /** Historical true-margin rate as a percentage (negative = loses money). */
  marginRatePct: number;
  isMoneyLoser: boolean;
  /** Minimum price to break even; null when there is no revenue history to scale. */
  suggestedMinimum: number | null;
}

interface GuardrailData {
  warning: boolean;
  severity: Severity;
  message: string;
  customer?: GuardrailCustomer;
}

type GuardrailResponse = { data: GuardrailData | null; error: string | null };

interface GuardrailBody {
  tenantId?: string;
  customerId?: string;
  customerName?: string;
  quoteAmount?: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function money(n: number, currency: string): string {
  const symbols: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };
  const sym = symbols[currency];
  const body = Math.round(Math.abs(n)).toLocaleString("en-GB");
  const sign = n < 0 ? "-" : "";
  return sym ? `${sign}${sym}${body}` : `${sign}${body} ${currency}`;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Match by exact id first, then by normalized name (exact, then contains). */
function findCustomer(
  verdict: Verdict,
  customerId?: string,
  customerName?: string,
): CustomerMargin | null {
  if (customerId) {
    const byId = verdict.customers.find((c) => c.customerId === customerId);
    if (byId) return byId;
  }
  if (customerName && customerName.trim().length > 0) {
    const want = norm(customerName);
    const exact = verdict.customers.find((c) => norm(c.customerName) === want);
    if (exact) return exact;
    const partial = verdict.customers.filter(
      (c) => norm(c.customerName).includes(want) || want.includes(norm(c.customerName)),
    );
    if (partial.length === 1) return partial[0];
  }
  return null;
}

function nonWarning(message: string): NextResponse<GuardrailResponse> {
  return NextResponse.json(
    { data: { warning: false, severity: "none", message }, error: null },
    { status: 200 },
  );
}

function readQuoteAmount(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function POST(request: Request): Promise<NextResponse<GuardrailResponse>> {
  const body = (await request.json().catch(() => ({}))) as GuardrailBody;
  const customerId = typeof body.customerId === "string" ? body.customerId : undefined;
  const customerName = typeof body.customerName === "string" ? body.customerName : undefined;
  const quoteAmount = readQuoteAmount(body.quoteAmount);
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : undefined;

  if (!customerId && !customerName) {
    return nonWarning(
      "No customer supplied. Pass customerId or customerName to check a quote against its history.",
    );
  }

  // Read the latest stored verdict (or the validated mock). A read failure or a
  // missing verdict is graceful: we simply cannot warn without history.
  let verdict: Verdict;
  try {
    const result = await resolveVerdict(tenantId);
    if (!result.data) {
      return nonWarning(
        `No verdict available yet to check this quote against. ${result.error ?? "Run the pipeline first."}`,
      );
    }
    verdict = result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown verdict lookup error.";
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }

  const label = customerName ?? customerId ?? "that customer";
  const customer = findCustomer(verdict, customerId, customerName);
  if (!customer) {
    return nonWarning(
      `No stored history for ${label} in ${verdict.tenantName}. Nothing to warn about on this quote.`,
    );
  }

  const currency = customer.currency;
  const revenue = customer.revenue;
  const trueMargin = customer.trueMargin;
  const totalCost = round2(revenue - trueMargin);
  const hasRevenue = revenue > 0;
  const marginRate = hasRevenue ? trueMargin / revenue : null; // fraction, negative = loss
  const costRatio = hasRevenue ? totalCost / revenue : null; // >1 means loses money
  const marginRatePct = round2((marginRate ?? (trueMargin < 0 ? -1 : 0)) * 100);

  const isLoser = customer.isMoneyLoser || trueMargin < 0;

  // A profitable customer: no warning, but still return their (healthy) history.
  if (!isLoser) {
    const summary: GuardrailCustomer = {
      customerId: customer.customerId,
      customerName: customer.customerName,
      currency,
      revenue,
      trueMargin,
      marginRatePct,
      isMoneyLoser: customer.isMoneyLoser,
      suggestedMinimum: null,
    };
    return NextResponse.json(
      {
        data: {
          warning: false,
          severity: "none",
          message:
            `${customer.customerName} is currently profitable: ${money(trueMargin, currency)} of true margin on ` +
            `${money(revenue, currency)} of revenue (${marginRatePct}% margin). No guardrail warning for this quote.`,
          customer: summary,
        },
        error: null,
      },
      { status: 200 },
    );
  }

  // A money-loser (or a losing historical rate): warn, cite history, suggest a floor.
  // suggestedMinimum = the price at which this quote would break even. With a
  // quote we scale by the historical cost ratio; without one we fall back to the
  // historical break-even revenue (its true cost).
  let suggestedMinimum: number | null;
  if (quoteAmount !== undefined && costRatio !== null) {
    suggestedMinimum = round2(quoteAmount * costRatio);
  } else if (costRatio !== null) {
    suggestedMinimum = round2(totalCost);
  } else {
    // No revenue history to scale against; the floor is at least the sunk cost.
    suggestedMinimum = trueMargin < 0 ? round2(-trueMargin) : null;
  }

  // isLoser guarantees a negative margin, so this is a loss of at least "medium";
  // a double-digit percentage loss (or no revenue at all) escalates to "high".
  const lossFraction = marginRate !== null ? -marginRate : 1; // 100% if no revenue
  const severity: Severity = lossFraction >= 0.1 ? "high" : "medium";

  let message =
    `Careful: ${customer.customerName} is a known money-loser. Historically ${money(revenue, currency)} of ` +
    `revenue is outweighed by ${money(totalCost, currency)} of true cost, a ${money(trueMargin, currency)} ` +
    `result (${marginRatePct}% true margin).`;

  if (quoteAmount !== undefined) {
    if (marginRate !== null) {
      const projectedMargin = round2(quoteAmount * marginRate);
      message +=
        ` A quote of ${money(quoteAmount, currency)} at that rate would be expected to lose about ` +
        `${money(Math.abs(projectedMargin), currency)}.`;
    } else {
      message += ` This customer has produced cost with no matching revenue, so any quote is at risk.`;
    }
    if (suggestedMinimum !== null) {
      message += ` Price it at least ${money(suggestedMinimum, currency)} to break even.`;
    }
  } else if (suggestedMinimum !== null) {
    message += ` To break even you would need to have charged at least ${money(suggestedMinimum, currency)}; price new work with that cost ratio in mind.`;
  }

  const summary: GuardrailCustomer = {
    customerId: customer.customerId,
    customerName: customer.customerName,
    currency,
    revenue,
    trueMargin,
    marginRatePct,
    isMoneyLoser: customer.isMoneyLoser,
    suggestedMinimum,
  };

  return NextResponse.json(
    { data: { warning: true, severity, message, customer: summary }, error: null },
    { status: 200 },
  );
}
