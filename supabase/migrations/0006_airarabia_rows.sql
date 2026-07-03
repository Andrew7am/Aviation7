-- 0006 airarabia_rows: verbatim copy of the "Air Arabia " sheet from Aviation seed workbook
-- 18 data rows in the canonical seed.

create table if not exists airarabia_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  reference_code                   text,
  transaction_date                 text,
  debit_amount                     text,
  credit_amount                    text,
  balance                          text,
  remarks                          text,
  ticket_number                    text,
  custmoner_name                   text,
  user_id                          text,
  request_number                   text,
  column2                          text,
  status                           text,
  created_at     timestamptz not null default now()
);

create index if not exists airarabia_rows_source_row_num_idx on airarabia_rows(source_row_num);
create index if not exists airarabia_rows_vendor_import_id_idx on airarabia_rows(vendor_import_id);
