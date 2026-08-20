-- Procurement ledger - paste into the Supabase SQL editor.
-- Mirrors core/db.py. The local `synced` flag is deliberately absent: it is
-- SQLite-only bookkeeping and has no meaning on the server.

create table if not exists runs (
    id            uuid primary key,
    brief_text    text        not null,
    parsed_rules  jsonb,
    status        text        not null default 'running'
                  check (status in ('running','awaiting_approval','completed','failed')),
    created_at    timestamptz not null default now(),
    completed_at  timestamptz
);

create table if not exists listings_snapshot (
    id         uuid primary key,
    run_id     uuid        not null references runs(id) on delete cascade,
    listings   jsonb,
    fetched_at timestamptz not null default now()
);

create table if not exists decisions (
    id              uuid primary key,
    run_id          uuid        not null references runs(id) on delete cascade,
    chosen          jsonb,
    total_cost      integer,      -- whole rupees, e.g. 435600 = Rs 4,35,600
    latest_delivery integer,      -- days
    runner_up       jsonb,
    why_rejected    text,
    counterfactual  text,
    created_at      timestamptz not null default now()
);

create table if not exists approvals (
    id            uuid primary key,
    run_id        uuid        not null references runs(id) on delete cascade,
    question      text        not null,
    options       jsonb,
    chosen_option text,
    decided_at    timestamptz,
    created_at    timestamptz not null default now()
);

-- Every child table is read run-at-a-time by the dashboard.
create index if not exists ix_listings_snapshot_run_id on listings_snapshot (run_id);
create index if not exists ix_decisions_run_id         on decisions (run_id);
create index if not exists ix_approvals_run_id         on approvals (run_id);
create index if not exists ix_runs_created_at          on runs (created_at desc);

-- The sync worker connects with a plain API key and no user session, so row
-- level security must not block it. Simplest for a demo - keep RLS off:
alter table runs              disable row level security;
alter table listings_snapshot disable row level security;
alter table decisions         disable row level security;
alter table approvals         disable row level security;

-- If you prefer RLS on, drop the four lines above and use permissive policies
-- instead (still no auth involved):
-- alter table runs enable row level security;
-- create policy anon_all on runs for all using (true) with check (true);
