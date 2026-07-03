-- 0009 ibtekar_rows: verbatim copy of the "ibtekar" sheet from Aviation seed workbook
-- 265 data rows in the canonical seed.

create table if not exists ibtekar_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  date                             text,
  file_no                          text,
  doc_no                           text,
  col_4                            text,
  ticket                           text,
  pnr                              text,
  issue_date                       text,
  lpo_no                           text,
  passenger                        text,
  sector                           text,
  debit                            text,
  credit                           text,
  balance                          text,
  travel_date                      text,
  return_date                      text,
  status                           text,
  col_17                           text,
  mm                               text,
  created_at     timestamptz not null default now()
);

create index if not exists ibtekar_rows_source_row_num_idx on ibtekar_rows(source_row_num);
create index if not exists ibtekar_rows_vendor_import_id_idx on ibtekar_rows(vendor_import_id);
