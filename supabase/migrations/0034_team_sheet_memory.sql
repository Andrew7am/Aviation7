-- 0034 team_sheet_memory: what the Team Sheet Check remembers between runs.
--
-- sheet_explanations: a difference somebody has looked at and explained -
-- "the 4,600.00 on 5513437053 is not a refund; the team records a staff
-- liability that way". Held against the figures it was explained at, so it
-- stays explained only while nothing about it changes, and comes back the
-- moment something does.
--
-- team_sheet_snapshots: the last sheet uploaded, row by row, so the next
-- upload can say what is new, what changed and what went - and the person
-- reviewing reads the changes instead of the whole sheet again.

set search_path = public;

create table if not exists sheet_explanations (
  id           text primary key,
  user_id      uuid not null,
  -- verdict | ticket or PNR: the difference, not the row it was found on
  finding_key  text not null unique,
  -- the figures it was explained at; a change brings it back
  fingerprint  text not null,
  note         text not null,
  created_by   text,
  created_at   timestamptz not null default now()
);

create table if not exists team_sheet_snapshots (
  id           text primary key,
  user_id      uuid not null,
  file_name    text,
  uploaded_at  timestamptz not null default now(),
  rows         jsonb not null
);
create index if not exists team_sheet_snapshots_at_idx on team_sheet_snapshots (uploaded_at desc);

alter table sheet_explanations   enable row level security;
alter table team_sheet_snapshots enable row level security;

drop policy if exists sheet_explanations_read        on sheet_explanations;
drop policy if exists sheet_explanations_admin_write on sheet_explanations;
drop policy if exists team_sheet_snapshots_read        on team_sheet_snapshots;
drop policy if exists team_sheet_snapshots_admin_write on team_sheet_snapshots;

create policy sheet_explanations_read on sheet_explanations
  for select to authenticated using (true);
create policy sheet_explanations_admin_write on sheet_explanations
  for all to authenticated using (is_admin()) with check (is_admin());
create policy team_sheet_snapshots_read on team_sheet_snapshots
  for select to authenticated using (true);
create policy team_sheet_snapshots_admin_write on team_sheet_snapshots
  for all to authenticated using (is_admin()) with check (is_admin());
