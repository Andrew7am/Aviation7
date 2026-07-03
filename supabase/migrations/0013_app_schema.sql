-- 0013 app schema: tickets, vendor_balances, balance_topups, import_history,
-- error_log, audit_log — 1:1 port of the current Firestore collections
-- (tickets, vendorBalances, balanceTopUps, importHistory, errorLog, auditLog).
--
-- This is a lift-and-shift of the EXISTING data shape and business rules
-- (see core ERP invariants: duplicate key, REFUND-never-dup, TopUp saved
-- separately from tickets, resolveReq empty-only-if-blank-or-NEED-REQ).
-- No reconciliation/report redesign here — that comes later on top of the
-- vendor_*_rows raw tables from migrations 0002-0012.

set search_path = public;

create table if not exists tickets (
  id               text primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  ticket_no        text not null default '',
  source           text not null default '',
  date             text not null default '',
  amount           numeric not null default 0,
  commission       numeric not null default 0,
  total_doc        numeric not null default 0,
  req_num          text not null default '',
  pnr              text,
  passenger_name   text,
  airline_code     text,
  route            text,
  status           text,
  is_duplicate     boolean not null default false,
  import_batch_id  text,
  currency         text default 'SAR',
  transaction_type text,
  report_name      text,
  vendor_reference text,
  balance_after    numeric,
  import_time      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists tickets_user_id_idx on tickets(user_id);
create index if not exists tickets_source_idx on tickets(user_id, source);

create table if not exists vendor_balances (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  vendor_name     text not null,
  initial_balance numeric not null default 0,
  current_balance numeric not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists vendor_balances_user_id_idx on vendor_balances(user_id);

create table if not exists balance_topups (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  vendor_id   text not null references vendor_balances(id) on delete cascade,
  vendor_name text not null,
  amount      numeric not null default 0,
  note        text,
  date        text
);

create index if not exists balance_topups_user_id_idx on balance_topups(user_id);
create index if not exists balance_topups_vendor_id_idx on balance_topups(vendor_id);

create table if not exists import_history (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  vendor      text not null,
  report_name text,
  parser_name text,
  confidence  numeric,
  total_rows  integer not null default 0,
  imported    integer not null default 0,
  updated     integer not null default 0,
  topups      integer not null default 0,
  failed      integer not null default 0,
  warnings    integer not null default 0,
  duration_ms integer not null default 0,
  imported_at timestamptz not null default now()
);

create index if not exists import_history_user_id_idx on import_history(user_id, imported_at desc);

create table if not exists error_log (
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  vendor     text,
  row_number integer,
  raw_data   text,
  error      text,
  import_id  text references import_history(id) on delete cascade,
  logged_at  timestamptz not null default now()
);

create index if not exists error_log_import_id_idx on error_log(import_id);

create table if not exists audit_log (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  action       text not null,
  entity       text,
  detail       text,
  performed_at timestamptz not null default now()
);

create index if not exists audit_log_user_id_idx on audit_log(user_id, performed_at desc);

-- === RLS: every table is scoped to the owning user, matching the current
-- Firestore rule of `where userId == this.userId` ===

alter table tickets enable row level security;
alter table vendor_balances enable row level security;
alter table balance_topups enable row level security;
alter table import_history enable row level security;
alter table error_log enable row level security;
alter table audit_log enable row level security;

create policy tickets_owner on tickets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy vendor_balances_owner on vendor_balances
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy balance_topups_owner on balance_topups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy import_history_owner on import_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy error_log_owner on error_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy audit_log_owner on audit_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- === Enable realtime (Supabase equivalent of Firestore onSnapshot) ===
alter publication supabase_realtime add table tickets;
alter publication supabase_realtime add table vendor_balances;
alter publication supabase_realtime add table balance_topups;
alter publication supabase_realtime add table import_history;
alter publication supabase_realtime add table error_log;
