# Standard

The profit truth on every customer — for Xero.

Standard is a zero-setup, retroactive AI profit-attribution app for Xero. It reads the
books a small business already has, auto-categorises every cost to the customer it served,
and ranks **true margin per customer** — revealing which customers secretly lose money once
real costs are attributed. Every number traces to its exact Xero transaction, and it drafts
the fix (a repricing email) and can re-tag the ledger so a Xero P&L-by-customer shows the truth.

Built for the Xero "Rise of the Builder" Hackathon (Bounty 01 — Small Business Productivity Powerhouse).

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tremor Raw** components (Tailwind v4), blue theme — the dashboard
- **xero-node** — Xero Accounting API (OAuth2), the single gateway
- **Supabase** (Postgres) — cached ledger snapshot + verdicts, keyed by `(tenantId, snapshotId)`
- **Anthropic Claude** — attribution proposals + drafted email (server-side, schema-validated)
- **Make (make.com)** — orchestrates on-demand / monthly / quote-guardrail scenarios (see `make/`)

## How it works

```
Connect Xero (OAuth2)  →  Ingest ledger → Supabase snapshot  →  Attribution engine
   (app/api/connect)        (app/api/refresh, lib/ingest)         (lib/attribution)
                                                                        │
                          Tremor dashboard  ←  Verdict contract  ←  Verdict builder
                          (app/(dashboard))     (lib/contracts)       (lib/verdict)
```

The **Verdict** (`lib/contracts/verdict.ts`) is the single contract between the engine and the
UI. Confidence is deterministic (native Xero link = High, match = Medium, inference = Low) — the
LLM proposes ties but never scores its own certainty. All Xero I/O goes through `lib/xero`.

## Run

```bash
npm install
cp .env.example .env.local   # fill in Xero, Supabase, Anthropic keys
npm run dev                  # http://localhost:3000
```

The dashboard runs against a validated mock (`NEXT_PUBLIC_USE_MOCK_VERDICT=true`) with zero
backend, so the UI is demoable immediately. Apply `supabase/schema.sql` in Supabase for the
live pipeline.

## Xero API surface

Reads: Contacts, Invoices (ACCREC + ACCPAY), BankTransactions, Payments, LinkedTransactions,
Items, Reports/ProfitAndLoss, Quotes. Writes: TrackingCategories + line re-tagging.
Scopes: `offline_access accounting.contacts accounting.transactions accounting.settings accounting.reports.read`.
