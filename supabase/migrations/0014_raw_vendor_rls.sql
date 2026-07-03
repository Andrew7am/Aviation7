-- 0014 raw vendor RLS: lock down vendor_*_rows + registry tables so the
-- public anon key can no longer read/write them unauthenticated (flagged
-- during the initial seed verification — anon key could SELECT from
-- `vendors` with RLS off by default).
--
-- Policy: any authenticated user of this ERP can read the reference vendor
-- data (it's shared reconciliation source data, not per-user). Writes stay
-- service_role-only (only the seed/import scripts write here).

set search_path = public;

alter table vendors enable row level security;
alter table vendor_columns enable row level security;
alter table vendor_imports enable row level security;
alter table iata_rows enable row level security;
alter table flydubai_rows enable row level security;
alter table flyadeal_dxb_rows enable row level security;
alter table flyadeal_ksa_rows enable row level security;
alter table airarabia_rows enable row level security;
alter table flynas_rows enable row level security;
alter table rts_ibtekar_rows enable row level security;
alter table ibtekar_rows enable row level security;
alter table rts_dxb_rows enable row level security;
alter table nsa_rows enable row level security;
alter table goldmedal_rows enable row level security;

create policy vendors_read_authenticated on vendors
  for select using (auth.role() = 'authenticated');
create policy vendor_columns_read_authenticated on vendor_columns
  for select using (auth.role() = 'authenticated');
create policy vendor_imports_read_authenticated on vendor_imports
  for select using (auth.role() = 'authenticated');
create policy iata_rows_read_authenticated on iata_rows
  for select using (auth.role() = 'authenticated');
create policy flydubai_rows_read_authenticated on flydubai_rows
  for select using (auth.role() = 'authenticated');
create policy flyadeal_dxb_rows_read_authenticated on flyadeal_dxb_rows
  for select using (auth.role() = 'authenticated');
create policy flyadeal_ksa_rows_read_authenticated on flyadeal_ksa_rows
  for select using (auth.role() = 'authenticated');
create policy airarabia_rows_read_authenticated on airarabia_rows
  for select using (auth.role() = 'authenticated');
create policy flynas_rows_read_authenticated on flynas_rows
  for select using (auth.role() = 'authenticated');
create policy rts_ibtekar_rows_read_authenticated on rts_ibtekar_rows
  for select using (auth.role() = 'authenticated');
create policy ibtekar_rows_read_authenticated on ibtekar_rows
  for select using (auth.role() = 'authenticated');
create policy rts_dxb_rows_read_authenticated on rts_dxb_rows
  for select using (auth.role() = 'authenticated');
create policy nsa_rows_read_authenticated on nsa_rows
  for select using (auth.role() = 'authenticated');
create policy goldmedal_rows_read_authenticated on goldmedal_rows
  for select using (auth.role() = 'authenticated');

-- No insert/update/delete policies are created for anon or authenticated —
-- only service_role (which bypasses RLS entirely) can write, matching how
-- scripts/run-supabase-migrations.ts and scripts/seed-supabase.ts operate.
