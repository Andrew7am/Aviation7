-- 0035 airtable_live: the aviation team's Airtable, kept here live.
--
-- airtable_tickets: their "Aviation Tickets" table, one row per Airtable
-- record, refreshed every two minutes. `sheet_row` holds the record exactly
-- as their CSV export would print it, so the Team Sheet Check reads the live
-- copy with the same reader and reaches the same results as a file.
--
-- airtable_changes: every field that changed on their side, with what it
-- was and what it became - the record of what moved and when.
--
-- airtable_notifications: what a change means for our books, waiting for a
-- person: a request moved, a name or cabin we lack, a ticket bought online,
-- a refund or void, a price changed. Accepted or dismissed, never applied
-- on its own.
--
-- airtable_sync_state: where the sync is up to and whether it is healthy.

set search_path = public;

create table if not exists airtable_tickets (
  record_id      text primary key,
  sheet_row      jsonb not null,
  ticket_cell    text,
  serials        text[] not null default '{}',
  pnr            text,
  status         text,
  req_num        text,
  net_cost       numeric,
  currency       text,
  refund_amount  numeric,
  issued_at      timestamptz,
  client_name    text,
  cabin          text,
  portal         text,
  airline        text,
  team_member    text,
  old_ticket     text,
  old_pnr        text,
  created_at     timestamptz,
  last_modified  timestamptz,
  deleted        boolean not null default false,
  synced_at      timestamptz not null default now()
);
create index if not exists airtable_tickets_serials_idx on airtable_tickets using gin (serials);
create index if not exists airtable_tickets_pnr_idx on airtable_tickets (pnr);
create index if not exists airtable_tickets_req_idx on airtable_tickets (req_num);

create table if not exists airtable_changes (
  id          bigserial primary key,
  record_id   text not null,
  ticket_cell text,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now()
);
create index if not exists airtable_changes_at_idx on airtable_changes (changed_at desc);
create index if not exists airtable_changes_record_idx on airtable_changes (record_id);

create table if not exists airtable_notifications (
  id          uuid primary key default gen_random_uuid(),
  -- REQ_CHANGED | NAME | CABIN | ONLINE_TICKET | REFUND | VOID | PRICE
  kind        text not null,
  -- the same notice is raised once: kind|document|value
  dedupe_key  text not null unique,
  record_id   text,
  ticket_no   text,
  ticket_ids  text[] not null default '{}',
  req_num     text,
  title       text not null,
  detail      text,
  payload     jsonb not null default '{}'::jsonb,
  -- OPEN | ACCEPTED | DISMISSED
  state       text not null default 'OPEN',
  created_at  timestamptz not null default now(),
  decided_by  text,
  decided_at  timestamptz
);
create index if not exists airtable_notifications_open_idx on airtable_notifications (state, created_at desc);

create table if not exists airtable_sync_state (
  id            text primary key,
  -- the newest LAST_MODIFIED_TIME() seen; the next run asks for what is after it
  cursor        timestamptz,
  last_full_at  timestamptz,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  record_count  integer,
  last_changed  integer
);

alter table airtable_tickets        enable row level security;
alter table airtable_changes        enable row level security;
alter table airtable_notifications  enable row level security;
alter table airtable_sync_state     enable row level security;

drop policy if exists airtable_tickets_read on airtable_tickets;
drop policy if exists airtable_changes_read on airtable_changes;
drop policy if exists airtable_notifications_read on airtable_notifications;
drop policy if exists airtable_notifications_admin_write on airtable_notifications;
drop policy if exists airtable_sync_state_read on airtable_sync_state;

-- Everybody signed in reads; only the sync (service role) writes the copy,
-- and only an admin decides a notification.
create policy airtable_tickets_read on airtable_tickets for select to authenticated using (true);
create policy airtable_changes_read on airtable_changes for select to authenticated using (true);
create policy airtable_sync_state_read on airtable_sync_state for select to authenticated using (true);
create policy airtable_notifications_read on airtable_notifications for select to authenticated using (true);
create policy airtable_notifications_admin_write on airtable_notifications
  for update to authenticated using (is_admin()) with check (is_admin());
