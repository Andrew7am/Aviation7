-- Their Airtable's CSV export, on its way to the sync.
--
-- On 26 Oct 2026 the team's Airtable token stopped working. Until it is back
-- (or for good), their CSV export stands in for the API: the app writes its
-- rows here in pieces - a whole table is a few megabytes, past what one
-- request to the server may carry - and the sync reads them, matches each to
-- the record we hold (airtableCsv.ts) and deletes them.

create table if not exists public.airtable_csv_rows (
  upload_id  text not null,
  idx        integer not null,
  row        jsonb not null,
  created_at timestamptz not null default now(),
  primary key (upload_id, idx)
);

alter table public.airtable_csv_rows enable row level security;
drop policy if exists airtable_csv_rows_write on public.airtable_csv_rows;
create policy airtable_csv_rows_write on public.airtable_csv_rows
  for insert to authenticated with check (true);

notify pgrst, 'reload schema';
