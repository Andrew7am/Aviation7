-- 0012 goldmedal_rows: verbatim copy of the "goldmedal" sheet from Aviation seed workbook
-- 6 data rows in the canonical seed.

create table if not exists goldmedal_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  customer_no                      text,
  name                             text,
  transaction_type                 text,
  invoice_number                   text,
  invoice_date                     text,
  col_6                            text,
  passenger_name                   text,
  po_number                        text,
  curr                             text,
  original_amount                  text,
  balance_due                      text,
  status                           text,
  routing                          text,
  ticket_number                    text,
  created_at     timestamptz not null default now()
);

create index if not exists goldmedal_rows_source_row_num_idx on goldmedal_rows(source_row_num);
create index if not exists goldmedal_rows_vendor_import_id_idx on goldmedal_rows(vendor_import_id);
