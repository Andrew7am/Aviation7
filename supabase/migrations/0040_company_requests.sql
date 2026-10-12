-- 0040 company_requests: a request placed under a company by hand.
--
-- The company a ticket belongs to is read off the team's Airtable (their
-- MICE Account). Some requests are not on it at all - KSACO363 and
-- KSACO379, Sela's, 404 tickets between them - so nothing there can say
-- whose they are. A person says so here, by request, and it wins over
-- anything read from their sheet.

set search_path = public;

create table if not exists company_requests (
  req_key    text primary key,          -- the request number, upper case: KSACO363
  company    text not null,             -- as the Companies screen names it: "Sela - MICE"
  set_by     text,
  set_at     timestamptz not null default now()
);

alter table company_requests enable row level security;

drop policy if exists company_requests_read        on company_requests;
drop policy if exists company_requests_admin_write on company_requests;

create policy company_requests_read on company_requests
  for select to authenticated using (true);
create policy company_requests_admin_write on company_requests
  for all to authenticated using (is_admin()) with check (is_admin());

insert into company_requests (req_key, company, set_by) values
  ('KSACO363', 'Sela - MICE', 'accounting3@events-explorers.com'),
  ('KSACO379', 'Sela - MICE', 'accounting3@events-explorers.com')
on conflict (req_key) do update set company = excluded.company, set_by = excluded.set_by, set_at = now();

comment on table company_requests is
  'Requests placed under a company by hand - for requests the team''s Airtable does not carry.';
