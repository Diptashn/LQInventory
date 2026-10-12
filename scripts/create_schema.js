#!/usr/bin/env node
// One-time schema bootstrap for Neon (Postgres).
// Run: node scripts/create_schema.js  (or from any CWD)
const { Client } = require('pg');

const DATABASE_URL =
  'postgresql://neondb_owner:npg_5bjenFDg8BTQ@ep-flat-mountain-b3y8z56k-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const SQL = `
create table if not exists inventory_items (
  id           uuid primary key default gen_random_uuid(),
  entry_date   date    not null,
  product_name text    not null,
  quantity     numeric(12,3) not null check (quantity > 0),
  unit_cost    numeric(12,4) not null check (unit_cost >= 0),
  notes        text,
  created_at   timestamptz not null default now()
);

-- index on entry_date + product_name for month queries
create index if not exists idx_inventory_entry_product on inventory_items (entry_date, product_name);

-- row-level security: allow anon full access (personal use)
alter table inventory_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'inventory_items' and policyname = 'anon_all'
  ) then
    create policy anon_all on inventory_items
      for all using (true) with check (true);
  end if;
end
$$;

-- users table for authentication
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  username       text unique not null,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);

-- Index on username for faster login lookups
create index if not exists idx_users_username on users (username);
`;

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  console.log('Connected to Neon.');
  await client.query(SQL);
  console.log('Schema created / verified.');
  await client.end();
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
