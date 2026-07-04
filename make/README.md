# Standard — Make.com orchestration

Make.com is an **external SaaS**, so the scenarios cannot live in this repo. This
folder is the **build spec**: precise enough to recreate each scenario in
[make.com](https://make.com) in ~10 minutes. One file per scenario, plus the
email template the monthly digest fills.

## The one rule: AD-7 — Make orchestrates, code computes

**Make holds NO business logic.** All attribution, margin maths, confidence,
ranking, and the "why"/recommended-action wording are computed server-side and
already baked into the Verdict (AD-4) and the digest payload (FR-13). Make only:

1. **Triggers** (a webhook, a schedule, or a Xero event), and
2. **Moves data** between the app's API endpoints and email/notification modules.

If you ever feel tempted to add a filter that *computes* something (recompute a
margin, decide who is a money-loser, sum costs), stop — that belongs in the API.
The only branching Make does is on **flags the API already set** (e.g.
`isMoneyLoser`), which is a lookup, not logic.

## The endpoints Make talks to (this repo)

| Endpoint | Method | Purpose | Returns |
| --- | --- | --- | --- |
| `/api/verdict` | `GET` / `POST` | Latest Verdict for the tenant (FR-12) | `{ data: Verdict \| null, error: string \| null }` |
| `/api/digest` | `GET` | Compact monthly digest derived from the Verdict (FR-13) | `{ data: DigestPayload \| null, error: string \| null }` |
| `/api/refresh` | `POST` | (Track A) Re-ingest the Xero ledger → new snapshot | `{ data, error }` |

- **Response envelope:** every endpoint returns `{ data, error }`. `data` is
  `null` and HTTP `404` when there is no verdict yet; otherwise `data` is the
  payload and `error` is `null`.
- **Idempotent:** `/api/verdict` and `/api/digest` only *read* the stored
  Verdict — repeat calls return the same cached data and never call Xero
  (AD-3, NFR-RateLimit). Safe to retry.
- **Contract:** `data` on `/api/verdict` is the `Verdict` shape in
  [`lib/contracts/verdict.ts`](../lib/contracts/verdict.ts). Do not reach past it.
- **Demo mode:** with `NEXT_PUBLIC_USE_MOCK_VERDICT=true` (or before Supabase is
  wired) both endpoints serve the validated mock
  ([`fixtures/mock-verdict.json`](../fixtures/mock-verdict.json)), so the Make
  scenarios work end-to-end with zero backend.

## Scenarios

| # | File | Trigger | FR | Status |
| --- | --- | --- | --- | --- |
| 1 | [`scenario-on-demand.md`](./scenario-on-demand.md) | Inbound webhook | FR-12 | Core |
| 2 | [`scenario-monthly-digest.md`](./scenario-monthly-digest.md) | Schedule (monthly) | FR-13 | Core |
| 3 | [`scenario-quote-guardrail.md`](./scenario-quote-guardrail.md) | Xero "new Quote" | FR-14 | Stretch |

Email body for scenario 2: [`digest-email-template.md`](./digest-email-template.md).

## One-time setup (shared by all scenarios)

1. **Connection — HTTP.** No stored auth needed for the demo endpoints. If the
   app is later protected, add a header `Authorization: Bearer {{MAKE_API_TOKEN}}`
   on every HTTP module (store the token in Make, never in Xero).
2. **Connection — Email.** Connect the mailbox that sends the digest (Gmail,
   Microsoft 365, or a generic SMTP module).
3. **Connection — Xero** (scenario 3 only). Connect the Xero org so Make can
   watch for new Quotes. Make uses this only as a *trigger*; it never reads
   ledger detail — that is the app's job (AD-2).
4. **Variables.** Define these in each scenario (Make has no global vars):
   - `APP_BASE_URL` — e.g. `https://truemargin.vercel.app`
   - `TENANT_ID` — the connected Xero tenant id (optional; omit to use the
     single most recent verdict)
   - `DIGEST_TO` — recipient email for the monthly digest

## Data shapes (reference)

**`Verdict`** (from `/api/verdict`, see the contract for the full shape):

```jsonc
{
  "version": 1,
  "tenantId": "demo-tenant-0001",
  "tenantName": "Dave's Plumbing Ltd",
  "snapshotId": "snap-2026-07-05T09-00-00Z",
  "generatedAt": "2026-07-05T09:00:00Z",
  "baseCurrency": "GBP",
  "kpis": {
    "hiddenLossesUncovered": 7900,
    "moneyLoserCount": 2,
    "blendedStandard": 18450,
    "revenueAtRisk": 41200
  },
  "customers": [
    {
      "customerId": "cust-halton",
      "customerName": "Halton Estates",
      "revenue": 21400,
      "trueMargin": -3200,
      "currency": "GBP",
      "isMoneyLoser": true,
      "confidence": "High",
      "why": "Your biggest account by revenue is your biggest loss...",
      "draftedFix": "Hi Halton team, ...",
      "allocations": [ /* traceable source refs (FR-6) */ ]
    }
    // ...ranked ascending by trueMargin (money-losers first)
  ]
}
```

**`DigestPayload`** (from `/api/digest`):

```jsonc
{
  "version": 1,
  "tenantName": "Dave's Plumbing Ltd",
  "period": "July 2026",
  "generatedAt": "2026-07-05T09:00:00Z",
  "baseCurrency": "GBP",
  "subject": "Standard — July 2026: 2 money-losers, GBP 7,900 in hidden losses uncovered",
  "headline": "Dave's Plumbing Ltd: 2 accounts are costing you money. Worst is Halton Estates at GBP 3,200.",
  "kpis": { "hiddenLossesUncovered": 7900, "moneyLoserCount": 2, "blendedStandard": 18450, "revenueAtRisk": 41200 },
  "moneyLosers": [
    {
      "customerId": "cust-halton",
      "customerName": "Halton Estates",
      "revenue": 21400,
      "trueMargin": -3200,
      "currency": "GBP",
      "confidence": "High",
      "why": "Your biggest account by revenue is your biggest loss...",
      "recommendedAction": "Send the ready-to-go repricing email — Halton Estates is GBP 3,200 underwater on GBP 21,400 of revenue.",
      "draftReady": true
    }
  ],
  "topPerformer": { "customerName": "Tandel Developments", "trueMargin": 7600, "currency": "GBP" }
}
```

Everything a human needs — the ranking, the "why", the recommended action, the
subject line — is **already in the payload**. Make just delivers it.
