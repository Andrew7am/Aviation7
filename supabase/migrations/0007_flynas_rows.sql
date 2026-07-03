-- 0007 flynas_rows: verbatim copy of the "FlyNas" sheet from Aviation seed workbook
-- 19 data rows in the canonical seed.

create table if not exists flynas_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  date                             text,
  pnr2                             text,
  pax                              text,
  amount                           text,
  req_number                       text,
  balance                          text,
  column6                          text,
  status                           text,
  created_at     timestamptz not null default now()
);

create index if not exists flynas_rows_source_row_num_idx on flynas_rows(source_row_num);
create index if not exists flynas_rows_vendor_import_id_idx on flynas_rows(vendor_import_id);
