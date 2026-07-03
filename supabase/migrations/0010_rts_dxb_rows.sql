-- 0010 rts_dxb_rows: verbatim copy of the "RTS DXB" sheet from Aviation seed workbook
-- 249 data rows in the canonical seed.

create table if not exists rts_dxb_rows (
  id             uuid primary key default gen_random_uuid(),
  vendor_import_id uuid references vendor_imports(id) on delete set null,
  source_row_num integer not null,
  pnr_creation_date                text,
  record_locator                   text,
  passenger                        text,
  no                               text,
  col_5                            text,
  action                           text,
  total                            text,
  total_currency                   text,
  national_total                   text,
  national_currency                text,
  misc_fees                        text,
  grand_total                      text,
  currency_rate                    text,
  fop                              text,
  document_credit_total            text,
  sf_credit_total                  text,
  credit_currency                  text,
  credit_currency_rate             text,
  booking_terminal_id              text,
  ticketing_terminal_id            text,
  created_at     timestamptz not null default now()
);

create index if not exists rts_dxb_rows_source_row_num_idx on rts_dxb_rows(source_row_num);
create index if not exists rts_dxb_rows_vendor_import_id_idx on rts_dxb_rows(vendor_import_id);
