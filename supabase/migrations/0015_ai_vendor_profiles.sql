-- 0015 ai_vendor_profiles: column-mapping profiles learned by the AI analyzer.
--
-- When a report format no builtin parser recognizes is uploaded, the AI
-- analyzes headers + sample rows ONCE and produces a column mapping. That
-- mapping is stored here keyed by the header fingerprint (normalized header
-- row), so every future upload of the same format is parsed deterministically
-- by ProfileParser with zero AI calls.
--
-- Profiles are company-wide reference data (like vendors/vendor_columns),
-- not per-user: any authenticated user of the ERP can read and create them.

set search_path = public;

create table if not exists ai_vendor_profiles (
  id           uuid primary key default gen_random_uuid(),
  vendor_name  text not null,
  fingerprint  text not null unique,
  headers      jsonb not null,
  columns      jsonb not null,
  rules        jsonb,
  is_lcc       boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  usage_count  integer not null default 0,
  last_used_at timestamptz
);

create index if not exists ai_vendor_profiles_fingerprint_idx on ai_vendor_profiles(fingerprint);

alter table ai_vendor_profiles enable row level security;

create policy ai_vendor_profiles_select_authenticated on ai_vendor_profiles
  for select using (auth.role() = 'authenticated');

create policy ai_vendor_profiles_insert_authenticated on ai_vendor_profiles
  for insert with check (auth.role() = 'authenticated');

create policy ai_vendor_profiles_update_authenticated on ai_vendor_profiles
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
