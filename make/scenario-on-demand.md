# Scenario 1 — On-demand verdict (FR-12)

**Story 4.1.** Trigger the app on demand and hand the fresh Verdict back to
whoever asked (a button, a Slack slash-command, another scenario, a curl).

> **AD-7:** Make does not compute anything here. It relays a request to
> `/api/verdict` and returns the Verdict the app already computed.

## Trigger

**Custom webhook** (Make module: *Webhooks → Custom webhook*).

- Method: `POST` (also works with `GET`).
- Make gives you a URL like `https://hook.eu2.make.com/xxxxxxxx`. That URL is
  what your button / Slack command / caller hits.
- Optional inbound JSON body: `{ "tenantId": "demo-tenant-0001" }`. If omitted,
  the app returns the single most recent verdict.

## Module chain

```
[1] Webhooks: Custom webhook   (trigger)
        │  passes through: tenantId (optional)
        ▼
[2] HTTP: Make a request       (call the app)
        │  → returns Verdict JSON
        ▼
[3] Webhooks: Webhook response (return Verdict to the caller)
```

### Module 2 — HTTP: Make a request

| Field | Value |
| --- | --- |
| URL | `{{APP_BASE_URL}}/api/verdict` |
| Method | `POST` |
| Headers | `Content-Type: application/json` (+ `Authorization: Bearer {{MAKE_API_TOKEN}}` if the app is protected) |
| Body type | Raw / JSON |
| Request content | `{ "tenantId": "{{1.tenantId}}" }` — omit the body entirely to use the latest verdict |
| Parse response | **Yes** (so `data`/`error` become mappable fields) |

The response body is the standard envelope:

```jsonc
{
  "data": { /* Verdict — see lib/contracts/verdict.ts */ },
  "error": null
}
```

- HTTP `200` → `data` is the Verdict, `error` is `null`.
- HTTP `404` → `data` is `null`, `error` explains there is no verdict yet
  (run `POST /api/refresh` first). This is not a Make failure — branch on it if
  you want a friendly message.

### Module 3 — Webhooks: Webhook response

| Field | Value |
| --- | --- |
| Status | `{{2.statusCode}}` (pass the app's status straight through) |
| Body | `{{2.data}}` wrapped as `{ "data": {{2.data}}, "error": {{2.error}} }` — or just relay `{{2.body}}` verbatim |
| Headers | `Content-Type: application/json` |

## Idempotency & rate limits (NFR-RateLimit)

`/api/verdict` only reads the **stored** Verdict — it does not recompute or call
Xero. So re-triggering this scenario is free and returns the same cached data
(AD-3). If the caller actually wants *fresh numbers from Xero*, that is a
different, heavier action: call `POST /api/refresh` (Track A) to re-ingest, then
call this scenario. Keep the two separate so a rapid-fire button can't blow the
Xero 1,000/day cap.

## Error handling

- Add an **Error handler** (right-click module 2 → *Add error handler* →
  *Resume*) that maps `{ "data": null, "error": "upstream unreachable" }` into
  module 3 so the caller always gets a clean envelope.
- Do **not** retry automatically against Xero. Retrying `/api/verdict` is safe
  (idempotent); retrying a refresh is not (rate budget).

## Test

1. Set `APP_BASE_URL` and (optionally) `NEXT_PUBLIC_USE_MOCK_VERDICT=true` on the
   app so it serves the mock.
2. Run the scenario once; Make shows the webhook URL.
3. `curl -X POST <webhook-url> -H 'content-type: application/json' -d '{}'`.
4. Expect the mock Verdict (Dave's Plumbing, Halton Estates as a money-loser)
   back in the `data` field.
