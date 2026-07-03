-- 0002 iata_rows: verbatim copy of the "IATA" sheet from Aviation seed workbook
-- 1568 data rows in the canonical seed.

create table if not exists iata_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  col_1                            text,
  serial                           text,
  airline_key                      text,
  ticket_number                    text,
  total                            text,
  tax                              text,
  comm                             text,
  net                              text,
  pax_name                         text,
  pnr                              text,
  service                          text,
  req_number                       text,
  created_at     timestamptz not null default now()
);

create index if not exists iata_rows_source_row_num_idx on iata_rows(source_row_num);
create index if not exists iata_rows_vendor_import_id_idx on iata_rows(vendor_import_id);
