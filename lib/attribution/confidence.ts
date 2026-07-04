import type { Allocation, Confidence } from "../contracts/verdict";

/**
 * Deterministic confidence rubric (AD-5).
 *
 * Confidence is set by RULE from the signal type that produced an allocation —
 * never by the LLM. The LLM may propose a customer tie, but its inference is
 * always assigned Low here; it never reports its own certainty (AD-5, AD-9).
 *
 * Rubric:
 *   native Xero LinkedTransaction  -> High
 *   structured reference / contact / amount match, or a stated overhead driver -> Medium
 *   LLM inference                  -> Low
 *
 * Every function in this module is pure and side-effect free.
 */

/** The signal that produced an allocation. This is the only input to confidence. */
export type AttributionSignal =
  | "linked-transaction"
  | "reference-match"
  | "contact-match"
  | "amount-match"
  | "overhead-driver"
  | "llm-inference";

/** Rank so confidences can be compared/ordered deterministically. */
const RANK: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 };

/** The rubric itself (AD-5). Pure lookup, no LLM. */
export function confidenceForSignal(signal: AttributionSignal): Confidence {
  switch (signal) {
    case "linked-transaction":
      return "High";
    case "reference-match":
    case "contact-match":
    case "amount-match":
    case "overhead-driver":
      return "Medium";
    case "llm-inference":
      return "Low";
    default: {
      // Exhaustiveness guard — a new signal must be classified explicitly.
      const _never: never = signal;
      return _never;
    }
  }
}

/** Higher rank wins. Returns negative if a < b, positive if a > b. */
export function compareConfidence(a: Confidence, b: Confidence): number {
  return RANK[a] - RANK[b];
}

/**
 * Aggregate confidence for a customer's figure (AD-5).
 *
 * Anchored on the single largest-magnitude allocation: the headline margin is
 * only as trustworthy as the cost that dominates it. This is deterministic and
 * defensible — a big Low-confidence inference correctly drags the aggregate
 * down, while `lowConfidenceCount` separately flags the caveats (UX-DR6).
 */
export function aggregateConfidence(
  allocations: ReadonlyArray<Pick<Allocation, "amount" | "confidence">>,
): Confidence {
  if (allocations.length === 0) return "Low";
  let best = allocations[0];
  for (const a of allocations) {
    if (Math.abs(a.amount) > Math.abs(best.amount)) best = a;
  }
  return best.confidence;
}

/** Count of Low-confidence allocations — the "needs confirmation" tally (UX-DR6). */
export function lowConfidenceCount(
  allocations: ReadonlyArray<Pick<Allocation, "confidence">>,
): number {
  return allocations.reduce((n, a) => (a.confidence === "Low" ? n + 1 : n), 0);
}

/** Jargon-free label for a confidence level (UX-DR6: plain language, not scores). */
export function plainConfidence(confidence: Confidence): string {
  switch (confidence) {
    case "High":
      return "Solid — traced to a native Xero link";
    case "Medium":
      return "Likely — matched by reference or amount";
    case "Low":
      return "Needs a quick check — inferred";
    default: {
      const _never: never = confidence;
      return _never;
    }
  }
}
