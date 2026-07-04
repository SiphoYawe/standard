# Connect a real Xero org (Epic 1)

Standard reads a Xero organisation over OAuth2 (authorization-code flow). Follow
these steps once to connect a real org (use a Xero **demo company** so it is safe
to seed and reset).

## 1. Create a Xero app

1. Go to https://developer.xero.com/app/manage and sign in.
2. Click **New app**.
   - Integration type: **Web app**.
   - Company or application URL: `http://localhost:3000` (fine for local dev).
   - **Redirect URI**: `http://localhost:3000/api/connect/callback`
     (must match `XERO_REDIRECT_URI` exactly, including scheme, host, port, path).
3. Under **Configuration**, copy the **Client id** and generate a **Client secret**.

Notes:
- `http://localhost` is allowed for testing; `http://127.0.0.1` is not (Xero rule).
- Scopes are requested by the app at connect time (below); you do not set them in
  the portal. Since March 2026 new web apps are assigned granular scopes, and the
  connect check accepts the granular equivalents of the broad scopes we request,
  so a modern app connects cleanly.

## 2. Fill env

Copy `.env.example` to `.env.local` and fill in:

```
XERO_CLIENT_ID=...
XERO_CLIENT_SECRET=...
XERO_REDIRECT_URI=http://localhost:3000/api/connect/callback
XERO_SCOPES="offline_access accounting.contacts accounting.transactions accounting.settings accounting.reports.read"

SUPABASE_URL=...                      # or NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=...
```

`XERO_SCOPES` is the fixed submission set (Story 1.1). It must contain every
required scope; if it is missing one, `/api/connect` fails loudly rather than
connecting with reduced access.

Apply `supabase/schema.sql` in the Supabase SQL editor first so the
`xero_tokens` (and snapshot / rate-budget) tables exist.

## 3. Connect

1. `npm install && npm run dev`
2. Open `http://localhost:3000/api/connect`.
   - You are redirected to the Xero consent screen. A CSRF `state` is stored in an
     httpOnly cookie.
3. Choose the org (use the **Demo Company**) and consent.
4. Xero redirects to `/api/connect/callback`, which:
   - verifies the `state`,
   - exchanges the code for tokens,
   - **verifies the granted scopes** and fails loudly (HTTP 400, typed error) if a
     required one is missing,
   - resolves the tenant via `/connections`,
   - stores tokens server-side in Supabase (`xero_tokens`), and
   - redirects to `/` with `?connected=<tenantId>`.

Tokens never reach the browser (AD-8). The gateway (`lib/xero/gateway.ts`) is the
only holder of tokens and refreshes them automatically (access token 30 min,
refresh token 60 days).

## 4. Next steps

- Seed the demo data: `npx tsx scripts/seed-demo.ts` (see the header of that file).
- Snapshot the ledger: `POST /api/refresh` (the only path that reads live Xero).
