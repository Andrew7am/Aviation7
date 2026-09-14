-- 0023 vendor_statements: the vendor's own opening and closing balance.
--
-- Two vendors are settled differently from the rest. Ibtekar and NSA issue
-- against our own screen and then adjust the account on their side — a service
-- fee, a penalty, a correction we never see as a ticket. The wallet in
-- "Vendor Credit" cannot describe that: it computes a balance from what WE
-- recorded, so any adjustment the vendor made on their side is invisible to
-- it, and the two balances drift apart with nothing in the system saying by
-- how much or since when.
--
-- A statement is the vendor's own account of a period: what they held for us
-- when it opened, what they billed, what we paid, what they added themselves,
-- and what they held when it closed. Stored beside the tickets rather than
-- derived from them, because it is evidence, not a calculation — it is what we
-- will be held to when the account is settled.
--
-- Sign convention, as the vendor prints it: a POSITIVE balance is credit in
-- our favour (Ibtekar's "Cr" — they are holding our money), a negative one is
-- what we owe (their "Dr"). billed, paid and other_charges are all recorded as
-- positive magnitudes, and the period must foot:
--
--     closing = opening + paid - billed - other_charges
--
-- The period is a date range rather than a month because the vendors do not
-- cut on month ends: the first Ibtekar statement runs 01/08 to 14/09.

set search_path = public;

create table if not exists vendor_statements (
  id             text primary key,
  user_id        uuid not null,
  vendor_name    text not null,
  period_start   date not null,
  period_end     date not null,
  currency       text not null default 'SAR',
  opening_balance numeric not null default 0,
  closing_balance numeric not null default 0,
  billed         numeric not null default 0,
  paid           numeric not null default 0,
  other_charges  numeric not null default 0,
  source_file    text,
  note           text,
  created_at     timestamptz not null default now(),
  constraint vendor_statements_period check (period_end >= period_start),
  constraint vendor_statements_unique unique (vendor_name, period_start, period_end)
);

create index if not exists vendor_statements_vendor_period
  on vendor_statements (vendor_name, period_start);

alter table vendor_statements enable row level security;

-- Same split as every other table since 0019: the workspace reads, admins write.
drop policy if exists vendor_statements_read        on vendor_statements;
drop policy if exists vendor_statements_admin_write on vendor_statements;

create policy vendor_statements_read on vendor_statements
  for select to authenticated using (true);
create policy vendor_statements_admin_write on vendor_statements
  for all to authenticated using (is_admin()) with check (is_admin());
