-- A request's issued total reaching a figure, said by email once.
--
-- The user (25 Oct 2026): when KSAML2771 reaches 2,000,000, email
-- ticketing6@luxuryexplorersme.com and accounting3@events-explorers.com.
-- The Airtable sync (every two minutes) works the total out when the
-- request has changed, and sends the email once; reached_at and emailed_at
-- say what has happened, last_error why an email has not gone.

create table if not exists public.request_alerts (
  id          text primary key,
  req_num     text not null,
  threshold   numeric not null,
  currency    text not null,
  recipients  text[] not null,
  last_total  numeric,
  checked_at  timestamptz,
  reached_at  timestamptz,
  emailed_at  timestamptz,
  last_error  text,
  created_at  timestamptz not null default now()
);

alter table public.request_alerts enable row level security;
drop policy if exists request_alerts_read on public.request_alerts;
create policy request_alerts_read on public.request_alerts
  for select to authenticated using (true);

insert into public.request_alerts (id, req_num, threshold, currency, recipients)
values ('ksaml2771-2m', 'KSAML2771', 2000000, 'AED',
        array['ticketing6@luxuryexplorersme.com', 'accounting3@events-explorers.com'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
