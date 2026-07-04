import mockJson from "@/fixtures/mock-verdict.json";
import { parseVerdict, type Verdict } from "./verdict";

/**
 * The validated mock Verdict (Story 0.3). Tracks C (dashboard) and D (Make)
 * build entirely against this with zero backend. Validating at import time
 * means a fixture that drifts from the contract fails loudly.
 */
export const mockVerdict: Verdict = parseVerdict(mockJson);

export function getMockVerdict(): Verdict {
  return mockVerdict;
}
