-- Standard Supabase schema (AD-11): everything keyed by (tenant_id, snapshot_id).
-- Server-side access only (AD-8, NFR-Security). Run in the Supabase SQL editor.

-- Xero OAuth tokens, one row per connected tenant (AD-10).
create table if not exists xero_tokens (
  tenant_id       text primary key,
  tenant_name     text,
  access_token    text not null,
  refresh_token   text not null,
  expires_at      timestamptz not null,
  scopes          text not null,
  updated_at      timestamptz not null default now()
);

-- One row per ingest run (AD-3). The snapshot is the cache the pipeline reads.
create table if not exists snapshots (
  snapshot_id     text primary key,
  tenant_id       text not null references xero_tokens(tenant_id),
  created_at      timestamptz not null default now(),
  base_currency   text,
  -- raw normalised ledger objects for this snapshot, by object type
  ledger          jsonb not null default '{}'::jsonb,
  -- running Xero API call count for the day, for the rate budget (NFR-RateLimit)
  api_calls_today integer not null default 0
);
create index if not exists snapshots_tenant_idx on snapshots (tenant_id, created_at desc);

-- Computed verdicts (AD-4). Stored as the validated Verdict contract JSON.
create table if not exists verdicts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null,
  snapshot_id     text not null references snapshots(snapshot_id),
  created_at      timestamptz not null default now(),
  verdict         jsonb not null  -- validated against lib/contracts/verdict.ts
);
create index if not exists verdicts_tenant_idx on verdicts (tenant_id, created_at desc);

-- Write-back audit: what was re-tagged vs skipped (AD-6).
create table if not exists writeback_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null,
  snapshot_id     text not null,
  created_at      timestamptz not null default now(),
  written         jsonb not null default '[]'::jsonb,  -- line refs re-tagged
  skipped         jsonb not null default '[]'::jsonb   -- paid/reconciled/low-confidence
);

-- [Track A append] Per-tenant, per-day Xero API call counter (NFR-RateLimit, AD-2).
-- The gateway increments this on every Xero call and refuses non-essential reads
-- as a tenant approaches the 1,000/day cap (which does NOT reset on demo reset).
create table if not exists xero_rate_budget (
  tenant_id   text not null,
  day         date not null,
  calls       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, day)
);
