import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CustomerMargin } from "../contracts/verdict";

/**
 * Drafted fix (FR-9, AD-9): an editable, send-ready repricing email for a
 * money-loser, built from that customer's real figures. Uses one server-side,
 * schema-validated Claude call; falls back to a deterministic template when
 * ANTHROPIC_API_KEY is absent (or the call fails). Never auto-sent.
 */

export interface DraftOptions {
  useLlm?: boolean;
  apiKey?: string;
  model?: string;
  /** Owner name used to sign off. */
  ownerName?: string;
}

const DEFAULT_MODEL = "claude-opus-4-8";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function money(n: number, currency: string): string {
  const symbols: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };
  const sym = symbols[currency];
  const body = Math.round(Math.abs(n)).toLocaleString("en-GB");
  const sign = n < 0 ? "-" : "";
  return sym ? `${sign}${sym}${body}` : `${sign}${body} ${currency}`;
}

/** Uplift % needed to move from the current loss to a modest positive margin. */
function suggestedUpliftPct(customer: CustomerMargin, targetMargin = 0.15): number {
  const cost = customer.directCost + customer.overheadCost + customer.ownerTimeCost;
  if (customer.revenue <= 0 || cost <= 0) return 10;
  const targetRevenue = cost / (1 - targetMargin);
  const uplift = (targetRevenue / customer.revenue - 1) * 100;
  return Math.max(5, Math.round(uplift));
}

const DraftResponse = z.object({
  subject: z.string(),
  body: z.string(),
});

function extractJson(text: string): string {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}

async function draftViaLlm(customer: CustomerMargin, opts: DraftOptions): Promise<string> {
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : undefined);
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const owner = opts.ownerName ?? "The team";
  const cost = round2(customer.directCost + customer.overheadCost + customer.ownerTimeCost);
  const uplift = suggestedUpliftPct(customer);

  const facts = {
    customer: customer.customerName,
    currency: customer.currency,
    revenueInvoiced: customer.revenue,
    trueCost: cost,
    loss: round2(-customer.trueMargin),
    suggestedUpliftPct: uplift,
    owner,
  };

  const system =
    "You write short, warm, professional B2B repricing emails for a UK trades business. Ground every claim in the numbers provided; invent nothing. Keep it under 130 words. Respond with ONLY minified JSON: {\"subject\":\"...\",\"body\":\"...\"}.";
  const user =
    `Write a repricing email to this customer using these real figures:\n${JSON.stringify(facts)}\n` +
    `The account is currently running at a loss. Propose a rate adjustment of about ${uplift}% and, ` +
    `for larger jobs, a deposit. Sign off from ${owner}. Return only the JSON.`;

  const res = await client.messages.create({
    model,
    max_tokens: 700,
    system,
    messages: [{ role: "user", content: user }],
  });

  let text = "";
  for (const block of res.content) if (block.type === "text") text += block.text;

  // zod-validate the model output before it enters the pipeline (AD-9).
  const parsed = DraftResponse.parse(JSON.parse(extractJson(text)));
  return parsed.body.trim();
}

/** Deterministic fallback template — always works, no API key required. */
export function templateDraft(customer: CustomerMargin, ownerName = "The team"): string {
  const cur = customer.currency;
  const cost = round2(customer.directCost + customer.overheadCost + customer.ownerTimeCost);
  const loss = round2(-customer.trueMargin);
  const uplift = suggestedUpliftPct(customer);

  return (
    `Hi ${customer.customerName} team,\n\n` +
    `We've really valued working with you. Reviewing the recent jobs, our true costs on your ` +
    `account have come to ${money(cost, cur)} against ${money(customer.revenue, cur)} invoiced — ` +
    `which leaves us running at a ${money(loss, cur)} loss.\n\n` +
    `To keep giving you the same fast, reliable service, we'll need to adjust our rates by around ` +
    `${uplift}% from next month, and move to a deposit on larger jobs. Nothing changes about the ` +
    `quality of the work.\n\n` +
    `Happy to walk through the detail whenever suits.\n\n` +
    `Best,\n${ownerName}`
  );
}

export async function draftRepricingEmail(
  customer: CustomerMargin,
  opts: DraftOptions = {},
): Promise<string> {
  const useLlm = opts.useLlm ?? Boolean(opts.apiKey ?? process.env.ANTHROPIC_API_KEY);
  if (useLlm) {
    try {
      return await draftViaLlm(customer, opts);
    } catch {
      // Degrade safely to the deterministic template.
    }
  }
  return templateDraft(customer, opts.ownerName ?? "The team");
}
