/**
 * Story 1.4 - Seed the Xero demo company (DEMO-CRITICAL).
 * ======================================================
 *
 * Seeds a connected Xero organisation with a reproducible "profit truth" story
 * so the Standard reveal is believable every time:
 *
 *   - A FLAGSHIP CUSTOMER that is secretly a money-loser: high revenue, but a
 *     higher attributed cost once real costs are traced to it.
 *   - LINKEDTRANSACTION-BACKED COSTS (billable expenses) = the High-confidence
 *     native cost->customer signal (AD-5): supplier bills linked straight to the
 *     customer's sales invoice.
 *   - MESSY INFERENCE CASES: bank spend that only *hints* at the customer via a
 *     fuzzy reference or a description, with no native link (Medium/Low signal).
 *   - Plenty of EDITABLE lines for write-back: every sales invoice is left
 *     AUTHORISED-and-unpaid or DRAFT, and every bank line is left unreconciled,
 *     so re-tagging (AD-6) can move them into a per-customer tracking category
 *     and a Xero "P&L by tracking category" view shows the corrected truth.
 *
 * All Xero I/O goes through the single gateway (AD-2); this script never imports
 * xero-node directly.
 *
 * --------------------------------------------------------------------------
 * PREREQUISITES
 * --------------------------------------------------------------------------
 *  1. Connect a Xero *demo company* first: run the app and hit /api/connect,
 *     consent, and let the callback store tokens in Supabase. (Use a demo org so
 *     it is safe to reset. Settings > "My Xero" > Demo company in Xero.)
 *  2. Apply supabase/schema.sql so the xero_tokens table exists.
 *
 * REQUIRED ENV (same server-only vars the app uses; put them in .env.local):
 *     XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI
 *     SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 * OPTIONAL ENV:
 *     XERO_TENANT_ID   pin a specific connected org; otherwise the most recently
 *                      connected tenant is used.
 *
 * --------------------------------------------------------------------------
 * RUN
 * --------------------------------------------------------------------------
 *     npx tsx scripts/seed-demo.ts
 *
 * It loads .env.local / .env from the repo root automatically (no dotenv dep).
 * Contacts are reused by name, so re-running will not duplicate customers or
 * suppliers (Xero rejects duplicate contact names). Invoices and bank lines ARE
 * additive on each run, so reset the demo company in Xero for a clean slate.
 *
 * NOTE: this needs a live, connected Xero org to actually run. Without one it
 * exits early with a clear message (it cannot invent Xero data locally).
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  XeroGateway,
  resolveDefaultTenantId,
  type SeedAccount,
  type SeedCreatedDoc,
} from "../lib/xero/gateway";

/* ------------------------------------------------------------------ *
 * Minimal .env loader (no dependency; does not overwrite real env).
 * ------------------------------------------------------------------ */
function loadEnvFile(file: string): void {
  let text: string;
  try {
    text = readFileSync(resolvePath(process.cwd(), file), "utf8");
  } catch {
    return; // file absent is fine
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7) : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

/* ------------------------------------------------------------------ *
 * Small helpers.
 * ------------------------------------------------------------------ */
const REF = "STD-SEED"; // marks everything this script creates
const log = (msg: string) => console.log(msg);

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const DATE = isoDaysFromNow(-20);
const DUE = isoDaysFromNow(10);

function fail(message: string): never {
  console.error(`\nSeed aborted: ${message}\n`);
  process.exit(1);
}

/** Find an account of one of the given AccountTypes that has a usable code. */
function pickAccountByType(
  accounts: SeedAccount[],
  types: string[],
  requireCode: boolean,
): SeedAccount | undefined {
  return accounts.find(
    (a) =>
      a.type != null &&
      types.includes(a.type) &&
      (a.status == null || a.status === "ACTIVE") &&
      (!requireCode || (a.code != null && a.code !== "")),
  );
}

async function main(): Promise<void> {
  log("Standard demo seed (Story 1.4)\n" + "=".repeat(32));

  // 1) Resolve the connected tenant.
  const tenantId =
    process.env.XERO_TENANT_ID?.trim() || (await resolveDefaultTenantId());
  if (!tenantId) {
    fail(
      "No connected Xero tenant found. Connect a demo org via /api/connect first, " +
        "or set XERO_TENANT_ID.",
    );
  }
  log(`Tenant: ${tenantId}`);

  // 2) Open the gateway (loads + refreshes tokens through the single chokepoint).
  const gw = await XeroGateway.for(tenantId);

  // 3) Resolve chart-of-accounts codes to post against.
  const accounts = await gw.getAccounts();
  let bank = pickAccountByType(accounts, ["BANK"], false);
  const revenue = pickAccountByType(accounts, ["REVENUE", "SALES"], true);
  const expense = pickAccountByType(accounts, ["DIRECTCOSTS", "EXPENSE", "OVERHEADS"], true);
  if (!bank?.accountID && !bank?.code) {
    log("No BANK account found; creating one for the demo (Standard Demo Bank).");
    bank = await gw.createBankAccount("Standard Demo Bank", "0900");
  }
  if (!revenue?.code) fail("No revenue/sales account with a code found.");
  if (!expense?.code) fail("No expense/direct-costs account with a code found.");
  const revCode = revenue.code as string;
  const expCode = expense.code as string;
  log(
    `Accounts -> bank: ${bank!.name ?? bank!.accountID}, ` +
      `revenue: ${revCode} (${revenue.name}), expense: ${expCode} (${expense.name})`,
  );

  // 3b) Idempotent cleanup: void/delete anything a previous seed run created
  //     (marked with the REF prefix) so re-runs produce a clean, non-duplicated
  //     ledger. Linked transactions go first, since they block voiding invoices.
  const hasRef = (r?: string | null): boolean => (r ?? "").startsWith(REF);
  let cleaned = 0;
  for (const lt of await gw.getLinkedTransactions()) {
    if (lt.linkedTransactionID) {
      try {
        await gw.deleteLinkedTransaction(lt.linkedTransactionID);
        cleaned++;
      } catch {
        /* already gone */
      }
    }
  }
  for (const inv of await gw.getAllInvoices()) {
    if (hasRef(inv.reference) && inv.invoiceID) {
      try {
        await gw.voidOrDeleteInvoice(inv.invoiceID, String(inv.status) === "DRAFT");
        cleaned++;
      } catch {
        /* already void/paid */
      }
    }
  }
  for (const bt of await gw.getBankTransactions()) {
    if (hasRef(bt.reference) && bt.bankTransactionID) {
      try {
        await gw.deleteBankTransaction(bt.bankTransactionID);
        cleaned++;
      } catch {
        /* already gone */
      }
    }
  }
  if (cleaned) log(`Cleanup: removed ${cleaned} docs from previous seed run(s).`);

  // 4) Reuse contacts by name (Xero rejects duplicate contact names on re-run).
  const existing = await gw.getContacts();
  const byName = new Map<string, string>();
  for (const c of existing) {
    if (c.name && c.contactID) byName.set(c.name.toLowerCase(), c.contactID);
  }
  async function getOrCreateContact(name: string, email?: string): Promise<string> {
    const hit = byName.get(name.toLowerCase());
    if (hit) return hit;
    const created = await gw.createContact({ name, email });
    byName.set(name.toLowerCase(), created.contactID);
    log(`  + contact ${name}`);
    return created.contactID;
  }

  log("\nCreating contacts...");
  // Customers.
  const northwind = await getOrCreateContact("Northwind Traders", "ap@northwind.example");
  const rivergreen = await getOrCreateContact("Rivergreen Cafe", "owner@rivergreen.example");
  const blueHarbour = await getOrCreateContact("Blue Harbour Studios", "hello@blueharbour.example");
  // Suppliers (become suppliers once they carry ACCPAY bills / spend).
  const aceSub = await getOrCreateContact("Ace Subcontracting", "billing@acesub.example");
  const metroMaterials = await getOrCreateContact("Metro Materials", "accounts@metromat.example");
  const cityCourier = await getOrCreateContact("CityCourier", "invoices@citycourier.example");

  const linkedCount = { n: 0 };
  async function link(
    source: SeedCreatedDoc,
    customerID: string,
    target: SeedCreatedDoc,
  ): Promise<void> {
    const sourceLine = source.lineItems[0];
    const targetLine = target.lineItems[0];
    if (!sourceLine?.lineItemID || !targetLine?.lineItemID) {
      log("  ! skipped a link (missing line item id from Xero)");
      return;
    }
    await gw.createLinkedTransaction({
      sourceTransactionID: source.id,
      sourceLineItemID: sourceLine.lineItemID,
      contactID: customerID,
      targetTransactionID: target.id,
      targetLineItemID: targetLine.lineItemID,
    });
    linkedCount.n += 1;
  }

  /* ---------------- Flagship: Northwind Traders (money-loser) --------------- */
  log("\nNorthwind Traders (flagship, secretly a money-loser)...");
  // Revenue $24,000 (AUTHORISED + unpaid => editable for re-tag).
  const nwInvoice = await gw.createInvoice({
    type: "ACCREC",
    contactID: northwind,
    reference: `${REF} Northwind sales`,
    date: DATE,
    dueDate: DUE,
    status: "AUTHORISED",
    lineItems: [
      { description: "Website build - phase 1", unitAmount: 14000, accountCode: revCode },
      { description: "Website build - phase 2", unitAmount: 10000, accountCode: revCode },
    ],
  });
  log(`  ACCREC invoice ${nwInvoice.id} total ${nwInvoice.total}`);

  // High-confidence LINKED costs: supplier bills linked to the sales invoice.
  const nwBillLabour = await gw.createInvoice({
    type: "ACCPAY",
    contactID: aceSub,
    reference: `${REF} Northwind subcontract`,
    date: DATE,
    dueDate: DUE,
    status: "AUTHORISED",
    lineItems: [
      { description: "Contract dev for Northwind build", unitAmount: 13000, accountCode: expCode },
    ],
  });
  await link(nwBillLabour, northwind, nwInvoice);

  const nwBillMaterials = await gw.createInvoice({
    type: "ACCPAY",
    contactID: metroMaterials,
    reference: `${REF} Northwind hosting/licenses`,
    date: DATE,
    dueDate: DUE,
    status: "AUTHORISED",
    lineItems: [
      { description: "Hosting + licenses for Northwind", unitAmount: 5000, accountCode: expCode },
    ],
  });
  await link(nwBillMaterials, northwind, nwInvoice);
  log(`  linked costs: $18,000 (High confidence, ${linkedCount.n} billable expenses)`);

  // Messy inference costs: bank spend that only hints at Northwind (no link).
  await gw.createBankTransaction({
    type: "SPEND",
    bankAccountID: bank!.accountID,
    bankAccountCode: bank!.accountID ? undefined : bank!.code,
    contactID: cityCourier,
    reference: `${REF} NW Traders on-site visits`, // fuzzy nickname match
    date: DATE,
    lineItems: [
      { description: "Courier + travel, NW Traders", unitAmount: 5500, accountCode: expCode },
    ],
  });
  await gw.createBankTransaction({
    type: "SPEND",
    bankAccountID: bank!.accountID,
    bankAccountCode: bank!.accountID ? undefined : bank!.code,
    contactID: metroMaterials, // supplier on record; the customer is only inferred from the description
    reference: `${REF} Northwind support hours (overrun)`, // description-only inference
    date: DATE,
    lineItems: [
      { description: "Extra support for Northwind", unitAmount: 3500, accountCode: expCode },
    ],
  });
  log("  inference costs: $9,000 (Medium/Low; fuzzy reference + description-only)");
  log("  => Northwind: revenue $24,000 vs attributed cost $27,000 = -$3,000 (LOSS)");

  /* ---------------- Healthy contrast: Rivergreen Cafe ---------------------- */
  log("\nRivergreen Cafe (healthy, for contrast)...");
  const rgInvoice = await gw.createInvoice({
    type: "ACCREC",
    contactID: rivergreen,
    reference: `${REF} Rivergreen retainer`,
    date: DATE,
    dueDate: DUE,
    status: "AUTHORISED",
    lineItems: [{ description: "Monthly retainer", unitAmount: 8000, accountCode: revCode }],
  });
  const rgBill = await gw.createInvoice({
    type: "ACCPAY",
    contactID: aceSub,
    reference: `${REF} Rivergreen tasks`,
    date: DATE,
    dueDate: DUE,
    status: "AUTHORISED",
    lineItems: [{ description: "Ad-hoc tasks for Rivergreen", unitAmount: 2000, accountCode: expCode }],
  });
  await link(rgBill, rivergreen, rgInvoice);
  await gw.createBankTransaction({
    type: "SPEND",
    bankAccountID: bank!.accountID,
    bankAccountCode: bank!.accountID ? undefined : bank!.code,
    contactID: cityCourier,
    reference: `${REF} Rivergreen supplies`,
    date: DATE,
    lineItems: [{ description: "Sundry supplies, Rivergreen", unitAmount: 500, accountCode: expCode }],
  });
  log("  => Rivergreen: revenue $8,000 vs cost $2,500 = +$5,500 (healthy)");

  /* ---------------- Thin/messy: Blue Harbour Studios ---------------------- */
  log("\nBlue Harbour Studios (thin margin, DRAFT + messy inference)...");
  const bhInvoice = await gw.createInvoice({
    type: "ACCREC",
    contactID: blueHarbour,
    reference: `${REF} Blue Harbour brand`,
    date: DATE,
    dueDate: DUE,
    status: "DRAFT", // fully editable
    lineItems: [{ description: "Brand refresh", unitAmount: 6000, accountCode: revCode }],
  });
  const bhBill = await gw.createInvoice({
    type: "ACCPAY",
    contactID: metroMaterials,
    reference: `${REF} Blue Harbour print`,
    date: DATE,
    dueDate: DUE,
    status: "AUTHORISED",
    lineItems: [{ description: "Print run for Blue Harbour", unitAmount: 1800, accountCode: expCode }],
  });
  await link(bhBill, blueHarbour, bhInvoice);
  await gw.createBankTransaction({
    type: "SPEND",
    bankAccountID: bank!.accountID,
    bankAccountCode: bank!.accountID ? undefined : bank!.code,
    contactID: cityCourier,
    reference: `${REF} BH Studios stock photos`, // abbreviation-only inference
    date: DATE,
    lineItems: [{ description: "Stock photography, BH Studios", unitAmount: 1200, accountCode: expCode }],
  });
  log("  => Blue Harbour: revenue $6,000 vs cost $3,000 = +$3,000");

  /* ------------------------------ Summary -------------------------------- */
  log("\n" + "=".repeat(32));
  log("Seed complete.");
  log(`  Customers: Northwind Traders (LOSS), Rivergreen Cafe, Blue Harbour Studios`);
  log(`  Suppliers: Ace Subcontracting, Metro Materials, CityCourier`);
  log(`  LinkedTransactions (High-confidence billable expenses): ${linkedCount.n}`);
  log(`  Editable sales invoices: 2 AUTHORISED-unpaid + 1 DRAFT`);
  log(`  Editable (unreconciled) bank spend lines: 4`);
  log(`  Xero API calls spent: ${gw.apiCallsUsed}`);
  log(
    "\nNext: POST /api/refresh to snapshot this ledger, then run the verdict. " +
      "The reveal should surface Northwind Traders as a hidden money-loser.",
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nSeed failed: ${message}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
