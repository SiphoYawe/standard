# Scenario 2 — Monthly digest email (FR-13)

**Story 4.2.** On the first of each month, email the owner a plain-English
profit-truth digest — ranked money-losers with recommended actions — no login
required.

> **AD-7:** Make computes nothing. `/api/digest` returns a payload where the
> ranking, the "why", the recommended actions, and even the subject line are
> already written. Make schedules the call and formats the email from the payload.

## Trigger

**Schedule** (built into every Make scenario — *Scheduling* on the scenario).

- Run: **Once a month**, day `1`, time `08:00` (owner's timezone).
- Or advanced cron: `0 8 1 * *`.

## Module chain

```
[1] Schedule                    (monthly trigger)
        ▼
[2] HTTP: Make a request        (GET the digest payload)
        ▼
[3] Router / Filter             (branch on data == null?)
    ├─ has data ──▶ [4] Email: Send an email  (owner)
    └─ no data  ──▶ [5] Email: Send an email  (ops alert: "no verdict this month")
```

### Module 2 — HTTP: Make a request

| Field | Value |
| --- | --- |
| URL | `{{APP_BASE_URL}}/api/digest` |
| Method | `GET` |
| Query string | `tenantId={{TENANT_ID}}` (optional; omit for the latest verdict) |
| Headers | `Authorization: Bearer {{MAKE_API_TOKEN}}` (only if the app is protected) |
| Parse response | **Yes** |

Response envelope (`data` is the `DigestPayload`):

```jsonc
{
  "data": {
    "period": "July 2026",
    "subject": "Standard — July 2026: 2 money-losers, GBP 7,900 in hidden losses uncovered",
    "headline": "Dave's Plumbing Ltd: 2 accounts are costing you money...",
    "kpis": { "hiddenLossesUncovered": 7900, "moneyLoserCount": 2, "blendedStandard": 18450, "revenueAtRisk": 41200 },
    "moneyLosers": [
      { "customerName": "Halton Estates", "trueMargin": -3200, "revenue": 21400, "currency": "GBP",
        "confidence": "High", "why": "...", "recommendedAction": "Send the ready-to-go repricing email — ...", "draftReady": true }
    ],
    "topPerformer": { "customerName": "Tandel Developments", "trueMargin": 7600, "currency": "GBP" }
  },
  "error": null
}
```

### Module 3 — Router with a filter

- **Route A** — filter: `{{2.data}}` **Exists**. Continue to the email.
- **Route B** — fallback (no filter): send an internal "no verdict generated
  this month — run a refresh" note. Keeps the owner from getting a broken email.

This is a null-check branch, not business logic.

### Module 4 — Email: Send an email (the digest)

| Field | Value |
| --- | --- |
| To | `{{DIGEST_TO}}` |
| Subject | `{{2.data.subject}}` — pre-written by the API; use verbatim |
| Content type | HTML |
| Body | Fill [`digest-email-template.md`](./digest-email-template.md) from `2.data`. Use an **Iterator** over `{{2.data.moneyLosers}}` to render one block per money-loser, then a **Text aggregator** to join them into the body. |

**Recommended sub-chain for the body:**

```
[4a] Flow control: Iterator        source = {{2.data.moneyLosers}}
        ▼
[4b] Text aggregator               template = the per-customer block from the email template
        ▼
[4c] Email: Send an email          body = header + {{4b.text}} + footer (topPerformer, KPIs)
```

Every value the email needs — customer name, `trueMargin`, `why`,
`recommendedAction`, `draftReady` — comes straight from the payload. Do not
recompute or reformat numbers in Make beyond simple text concatenation.

## Idempotency & rate limits

`/api/digest` reads the **stored** Verdict; it does not call Xero. Running it
monthly (or re-running after a failure) is safe and returns the current verdict.
If the owner wants the digest to reflect *newly ingested* numbers, schedule a
`POST /api/refresh` (Track A) earlier in the day, then this digest at 08:00 — but
that refresh is optional and rate-limited; the digest works fine on the last
stored verdict.

## Error handling

- Error handler on module 2 → route to the ops-alert email so a failed API call
  is visible, not silent.
- Never auto-send a repricing email. The digest only *tells the owner a draft is
  ready* (`draftReady: true`); the owner sends it from the dashboard (FR-9).

## Test

1. `NEXT_PUBLIC_USE_MOCK_VERDICT=true` on the app.
2. In Make, hit **Run once** on the scenario.
3. Expect an email titled "Standard — <Month Year>: 2 money-losers…" listing
   Halton Estates and Mercer & Co with their recommended actions, and Tandel
   Developments as the top performer.
