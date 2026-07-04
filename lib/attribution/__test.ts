import ledgerJson from "../../fixtures/mock-ledger.json";
import { LedgerSnapshot } from "../contracts/ledger";
import { parseVerdict } from "../contracts/verdict";
import { buildVerdict } from "../verdict/build";

/**
 * End-to-end proof (Track B): mock-ledger.json -> attribution -> build -> a
 * Verdict that `parseVerdict` (Verdict.parse) accepts, with Halton a money-loser.
 * Runs with the deterministic no-LLM fallback so it needs no ANTHROPIC_API_KEY.
 *
 *   cd truemargin && npx --yes tsx lib/attribution/__test.ts
 */

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main(): Promise<void> {
  // 1. Parse the fixture against the INPUT contract.
  const snapshot = LedgerSnapshot.parse(ledgerJson);

  // 2. Run the pipeline in deterministic (no-LLM) mode.
  const built = await buildVerdict(snapshot, {
    useLlm: false,
    tenantName: "Dave's Plumbing Ltd",
    generatedAt: "2026-07-05T09:00:00Z",
  });

  // 3. The output MUST validate against the OUTPUT contract (AD-4).
  const verdict = parseVerdict(built);

  // 4. Domain assertions.
  const halton = verdict.customers.find((c) => c.customerId === "cust-halton");
  assert(halton, "Halton Estates must appear in the verdict");
  assert(halton.isMoneyLoser === true, "Halton must be flagged a money-loser");
  assert(halton.trueMargin < 0, "Halton trueMargin must be negative");
  assert(halton.allocations.length >= 3, "Halton must carry High + Medium + overhead allocations");
  assert(
    halton.allocations.some((a) => a.confidence === "High" && a.sources[0].type === "LinkedTransaction"),
    "Halton must have a High-confidence LinkedTransaction-backed cost",
  );
  assert(halton.draftedFix && halton.draftedFix.length > 0, "Halton (a loser) must have a drafted repricing email");
  assert(verdict.kpis.moneyLoserCount >= 1, "at least one money-loser expected");
  assert(
    verdict.customers[0].trueMargin <= verdict.customers[verdict.customers.length - 1].trueMargin,
    "customers must be ranked ascending by trueMargin",
  );

  // 5. Human-readable summary.
  console.log("\nStandard verdict (deterministic / no-LLM fallback)");
  console.log("=".repeat(64));
  for (const c of verdict.customers) {
    const flag = c.isMoneyLoser ? "LOSS " : "     ";
    console.log(
      `${flag}${c.customerName.padEnd(22)} rev £${c.revenue
        .toString()
        .padStart(7)}  margin £${c.trueMargin.toString().padStart(9)}  [${c.confidence}, low×${c.lowConfidenceCount}]`,
    );
  }
  console.log("-".repeat(64));
  console.log(
    `KPIs: hiddenLosses=£${verdict.kpis.hiddenLossesUncovered}  moneyLosers=${verdict.kpis.moneyLoserCount}  blendedTrueMargin=£${verdict.kpis.blendedTrueMargin}  revenueAtRisk=£${verdict.kpis.revenueAtRisk}`,
  );
  console.log(`\nHalton "why": ${halton.why}`);
  console.log("=".repeat(64));
  console.log(
    `PASS: Verdict.parse accepted the output — moneyLosers=${verdict.kpis.moneyLoserCount}, haltonMoneyLoser=${halton.isMoneyLoser}, haltonTrueMargin=${halton.trueMargin}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
