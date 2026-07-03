-- 0011 nsa_rows: verbatim copy of the "NSA" sheet from Aviation seed workbook
-- 2785 data rows in the canonical seed.

create table if not exists nsa_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  date                             text,
  notes                            text,
  event_month                      text,
  lpo_number                       text,
  operator_name                    text,
  request_number                   text,
  doc_no                           text,
  description                      text,
  pnr                              text,
  debit_sar                        text,
  credit_sar                       text,
  c_0utstanding_balances           text,
  col_13                           text,
  event_date                       text,
  reason_for_pending               text,
  created_at     timestamptz not null default now()
);

create index if not exists nsa_rows_source_row_num_idx on nsa_rows(source_row_num);
create index if not exists nsa_rows_vendor_import_id_idx on nsa_rows(vendor_import_id);
