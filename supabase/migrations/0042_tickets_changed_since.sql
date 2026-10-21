-- Read the ledger as what changed, not all of it.
--
-- Every open of the app read all 6,000+ tickets (1.8 MB), and again on every
-- return to the tab after five minutes. With the Airtable sync that put the
-- project over Supabase's 5 GB egress quota on 21 Oct 2026, and it was shut
-- off. The app now keeps the ledger on the device and asks only for rows
-- changed since it last looked - which needs a time each row last changed,
-- and a record of the rows that went.

alter table public.tickets add column if not exists updated_at timestamptz not null default now();
create index if not exists tickets_updated_at_idx on public.tickets (updated_at);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch before update on public.tickets
  for each row execute function public.touch_updated_at();

-- A deleted ticket leaves no row to ask about, so its id is kept here.
create table if not exists public.ticket_deletions (
  id text primary key,
  deleted_at timestamptz not null default now()
);
create index if not exists ticket_deletions_at_idx on public.ticket_deletions (deleted_at);

create or replace function public.log_ticket_deletion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ticket_deletions (id, deleted_at) values (old.id, now())
  on conflict (id) do update set deleted_at = excluded.deleted_at;
  return old;
end $$;

drop trigger if exists tickets_log_delete on public.tickets;
create trigger tickets_log_delete after delete on public.tickets
  for each row execute function public.log_ticket_deletion();

alter table public.ticket_deletions enable row level security;
drop policy if exists ticket_deletions_read on public.ticket_deletions;
create policy ticket_deletions_read on public.ticket_deletions
  for select to authenticated using (true);
