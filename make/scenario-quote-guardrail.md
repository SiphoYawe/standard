# Scenario 3 — Quote guardrail (FR-14) — STRETCH

**Story 6.2.** When a new Quote is raised in Xero for a customer the app has
already flagged as a money-loser, warn the owner *before* the work is priced —
turn hindsight into foresight.

> **AD-7:** Make computes nothing. Whether a customer is a money-loser, and why,
> is already decided by the app and carried on the Verdict (`isMoneyLoser`,
> `why`, `draftedFix`). Make watches Xero for a new Quote, asks the app for the
> Verdict, matches the Quote's contact against the money-loser list (a lookup,
> not a calculation), and sends a warning. No margin maths in Make.

## Trigger

**Xero → Watch Quotes** (Make's Xero app, *Watch Quotes* / *Watch records:
Quotes*), or a Xero webhook if enabled.

- Fires on a newly created Quote.
- Trigger output includes the Quote's `Contact.ContactID`, `QuoteNumber`,
  `Total`, and line items.

Make uses Xero here **only as a trigger**. It does not read ledger detail —
that is the app's job through the gateway (AD-2).

## Module chain

```
[1] Xero: Watch Quotes          (trigger — new Quote)
        ▼
[2] HTTP: Make a request        (GET the current Verdict from the app)
        ▼
[3] Iterator                    source = {{2.data.customers}}
        ▼
[4] Filter                      customerId == Quote.ContactID  AND  isMoneyLoser == true
        ▼
[5] Email / Slack               warning, quoting the app's own `why` + numbers
```

### Module 2 — HTTP: Make a request

| Field | Value |
| --- | --- |
| URL | `{{APP_BASE_URL}}/api/verdict` |
| Method | `GET` |
| Query string | `tenantId={{TENANT_ID}}` (optional) |
| Parse response | **Yes** |

Returns `{ data: Verdict, error }` — the same contract as scenario 1.

### Modules 3–4 — Match the Quote's contact to a money-loser

- **Iterator** over `{{2.data.customers}}`.
- **Filter** — pass only when **both** are true:
  - `{{3.customerId}}` **Equal to** `{{1.Contact.ContactID}}`
  - `{{3.isMoneyLoser}}` **Equal to** `true`

This is a pure comparison of IDs and a boolean the API already set. Make is not
deciding *who* loses money — it is looking up a verdict the app produced.

> **Cleaner alternative (recommended if built):** add a dedicated app endpoint
> `GET /api/quote-guardrail?contactId=...&amount=...` that does the match
> server-side and returns `{ data: { warn: boolean, reason, history }, error }`.
> Then Make drops the Iterator/Filter and just relays the warning — moving even
> the ID match out of Make and fully honouring AD-7. Track D owns that endpoint;
> it is out of scope for the core build and not yet implemented.

### Module 5 — Warn the owner

| Field | Value |
| --- | --- |
| To | `{{DIGEST_TO}}` (or a Slack channel) |
| Subject | `⚠️ Quote {{1.QuoteNumber}} is for a known money-loser: {{4.customerName}}` |
| Body | Use the app's own words: `{{4.why}}`. Add: "Last known true margin: `{{4.currency}} {{4.trueMargin}}` on `{{4.revenue}}` revenue. A repricing draft is ready in Standard — review before you send this quote." (Set `draftReady` from `{{4.draftedFix}}` presence.) |

The warning text is the app's precomputed `why` plus figures already on the
Verdict. Make writes no analysis of its own.

## Idempotency

`/api/verdict` is a read; calling it per Quote is safe and cheap (no Xero reads,
AD-3). If two Quotes arrive close together, each independently reads the same
cached Verdict — no state, no double-counting.

## Notes / limits

- **Stretch only** — build after the core loop demos (Epic 6).
- If a Quote is for a customer with **no** verdict yet (brand-new contact), the
  filter simply doesn't match and no warning is sent — correct behaviour.
- Never block or edit the Quote in Xero. This scenario is advisory: it emails a
  warning, the owner decides.

## Test

1. `NEXT_PUBLIC_USE_MOCK_VERDICT=true` on the app (Halton Estates =
   `cust-halton`, `isMoneyLoser: true`).
2. In Xero, raise a Quote to the contact whose id maps to `cust-halton`.
3. Expect a warning email quoting Halton's `why` and its `GBP -3,200` margin.
4. Raise a Quote to Oakwell Lettings (`isMoneyLoser: false`) → no warning.
