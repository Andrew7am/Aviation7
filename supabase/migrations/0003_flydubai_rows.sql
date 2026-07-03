-- 0003 flydubai_rows: verbatim copy of the "FLYDubai" sheet from Aviation seed workbook
-- 27 data rows in the canonical seed.

create table if not exists flydubai_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  invoice_no                       text,
  payment_date                     text,
  booking_reference                text,
  master_booking_reference         text,
  agency                           text,
  user_id                          text,
  amount                           text,
  deposit_date                     text,
  balance                          text,
  balance_due                      text,
  payment_reference                text,
  payer_id                         text,
  total_passengers                 text,
  total_segments                   text,
  order_no                         text,
  passenger_name                   text,
  departure_date                   text,
  booked_date                      text,
  remarks                          text,
  currency_code                    text,
  req_number                       text,
  status                           text,
  created_at     timestamptz not null default now()
);

create index if not exists flydubai_rows_source_row_num_idx on flydubai_rows(source_row_num);
create index if not exists flydubai_rows_vendor_import_id_idx on flydubai_rows(vendor_import_id);
