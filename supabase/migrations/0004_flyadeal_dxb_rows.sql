-- 0004 flyadeal_dxb_rows: verbatim copy of the "FlyAdeal DXB" sheet from Aviation seed workbook
-- 90 data rows in the canonical seed.

create table if not exists flyadeal_dxb_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  paymentdate                      text,
  pnr                              text,
  parentorganizationcode           text,
  organizationcode                 text,
  type                             text,
  passenger_name                   text,
  emailaddress                     text,
  phone                            text,
  bookingamount                    text,
  bookingcurrency                  text,
  accountamount                    text,
  accountcurrency                  text,
  balance                          text,
  promocode                        text,
  segmentcount                     text,
  sourceusercode                   text,
  req_number                       text,
  column1                          text,
  col_19                           text,
  col_20                           text,
  status                           text,
  created_at     timestamptz not null default now()
);

create index if not exists flyadeal_dxb_rows_source_row_num_idx on flyadeal_dxb_rows(source_row_num);
create index if not exists flyadeal_dxb_rows_vendor_import_id_idx on flyadeal_dxb_rows(vendor_import_id);
