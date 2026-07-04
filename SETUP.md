# Get Standard live (Supabase + Xero + seed)

A short checklist to go from mock to a real connected Xero demo company.
Total time: about 15 minutes. Nothing here needs code changes.

Already done for you: `.env.local` exists with the Supabase URL and publishable key.
You only need to add three secrets and run a few commands.

## 1. Supabase (about 3 min)

1. Open your project at https://supabase.com/dashboard  (project `resvuojvdhlurrkycvpv`).
2. Get the service-role key: Project Settings, then API, then copy the `service_role` secret.
3. Paste it into `standard/.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJ...    (the service_role secret)
   ```
4. Create the tables: open the SQL Editor, paste the entire contents of
   `standard/supabase/schema.sql`, and click Run. (This also turns on row-level
   security so the public key can never read your Xero tokens.)

## 2. Xero app (about 5 min)

1. Go to https://developer.xero.com/app/manage and sign in.
2. New app, type Web app.
   - Company URL: `http://localhost:3000`
   - Redirect URI: `http://localhost:3000/api/connect/callback`  (must match exactly)
3. Copy the Client id, then generate a Client secret.
4. Paste both into `standard/.env.local`:
   ```
   XERO_CLIENT_ID=...
   XERO_CLIENT_SECRET=...
   ```

## 3. (Optional) Anthropic key

The AI attribution works without a key (it uses a deterministic fallback), but a
key makes the cost-to-customer matching smarter. If you have one:
```
ANTHROPIC_API_KEY=sk-ant-...
```

## 4. Connect and seed (about 5 min)

From the `standard/` folder:

```bash
npm install
npm run dev
```

1. Open http://localhost:3000/api/connect in your browser.
2. On the Xero screen, pick the **Demo Company (Global)** and click Allow.
   You will be redirected back to the app.
3. Seed the demo company with the money-loser story:
   ```bash
   npx tsx scripts/seed-demo.ts
   ```
   This creates Northwind Traders (secretly losing about 3,000), a couple of
   healthy customers, linked-transaction costs, and editable lines for write-back.
4. Compute the verdict from the seeded data:
   ```bash
   curl -X POST http://localhost:3000/api/pipeline
   ```
5. Refresh http://localhost:3000 . The dashboard now shows the live Xero data
   instead of the mock.

## If something breaks

- The dashboard always falls back to the mock, so it stays demoable even if a step
  fails.
- Connect fails with a scope error: your Xero app is fine, just retry; the connect
  check accepts Xero's granular scopes.
- Rate limit (HTTP 429): Xero allows 1,000 calls per day per org and does not reset
  on demo-company reset. Avoid re-seeding many times; keep a spare demo org in
  reserve for the live pitch.
- Deploying to Vercel later: set the same env vars in the Vercel project, and add
  your Vercel URL plus `/api/connect/callback` as a second redirect URI in the Xero app.
