-- seed.sql — bulk-load canonical Aviation seed workbook into vendor_*_rows tables
-- Run AFTER 0001..0012 migrations.  Requires psql (Supabase gives you a connection
-- string under Project Settings -> Database).  Example:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f seed.sql
--
-- Each block: create a vendor_imports row, then \copy the CSV into the vendor table
-- tagged with that import id.  Reruns wipe the previous seed for that vendor first
-- so this is idempotent.

begin;

-- === iata (IATA) — 1568 rows ===
delete from iata_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('iata', 'Aviation 1 (2).xlsx', 'seed', 1568)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_iata_rows (source_row_num integer, col_1 text, serial text, airline_key text, ticket_number text, total text, tax text, comm text, net text, pax_name text, pnr text, service text, req_number text);
\copy _stage_iata_rows(source_row_num, col_1, serial, airline_key, ticket_number, total, tax, comm, net, pax_name, pnr, service, req_number) from 'seed_data/iata_rows.csv' with (format csv, header true)
insert into iata_rows (vendor_import_id, source_row_num, col_1, serial, airline_key, ticket_number, total, tax, comm, net, pax_name, pnr, service, req_number)
  select :'import_id'::uuid, source_row_num, col_1, serial, airline_key, ticket_number, total, tax, comm, net, pax_name, pnr, service, req_number from _stage_iata_rows;
drop table _stage_iata_rows;

-- === flydubai (FLYDubai) — 27 rows ===
delete from flydubai_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('flydubai', 'Aviation 1 (2).xlsx', 'seed', 27)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_flydubai_rows (source_row_num integer, invoice_no text, payment_date text, booking_reference text, master_booking_reference text, agency text, user_id text, amount text, deposit_date text, balance text, balance_due text, payment_reference text, payer_id text, total_passengers text, total_segments text, order_no text, passenger_name text, departure_date text, booked_date text, remarks text, currency_code text, req_number text, status text);
\copy _stage_flydubai_rows(source_row_num, invoice_no, payment_date, booking_reference, master_booking_reference, agency, user_id, amount, deposit_date, balance, balance_due, payment_reference, payer_id, total_passengers, total_segments, order_no, passenger_name, departure_date, booked_date, remarks, currency_code, req_number, status) from 'seed_data/flydubai_rows.csv' with (format csv, header true)
insert into flydubai_rows (vendor_import_id, source_row_num, invoice_no, payment_date, booking_reference, master_booking_reference, agency, user_id, amount, deposit_date, balance, balance_due, payment_reference, payer_id, total_passengers, total_segments, order_no, passenger_name, departure_date, booked_date, remarks, currency_code, req_number, status)
  select :'import_id'::uuid, source_row_num, invoice_no, payment_date, booking_reference, master_booking_reference, agency, user_id, amount, deposit_date, balance, balance_due, payment_reference, payer_id, total_passengers, total_segments, order_no, passenger_name, departure_date, booked_date, remarks, currency_code, req_number, status from _stage_flydubai_rows;
drop table _stage_flydubai_rows;

-- === flyadeal_dxb (FlyAdeal DXB) — 90 rows ===
delete from flyadeal_dxb_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('flyadeal_dxb', 'Aviation 1 (2).xlsx', 'seed', 90)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_flyadeal_dxb_rows (source_row_num integer, paymentdate text, pnr text, parentorganizationcode text, organizationcode text, type text, passenger_name text, emailaddress text, phone text, bookingamount text, bookingcurrency text, accountamount text, accountcurrency text, balance text, promocode text, segmentcount text, sourceusercode text, req_number text, column1 text, col_19 text, col_20 text, status text);
\copy _stage_flyadeal_dxb_rows(source_row_num, paymentdate, pnr, parentorganizationcode, organizationcode, type, passenger_name, emailaddress, phone, bookingamount, bookingcurrency, accountamount, accountcurrency, balance, promocode, segmentcount, sourceusercode, req_number, column1, col_19, col_20, status) from 'seed_data/flyadeal_dxb_rows.csv' with (format csv, header true)
insert into flyadeal_dxb_rows (vendor_import_id, source_row_num, paymentdate, pnr, parentorganizationcode, organizationcode, type, passenger_name, emailaddress, phone, bookingamount, bookingcurrency, accountamount, accountcurrency, balance, promocode, segmentcount, sourceusercode, req_number, column1, col_19, col_20, status)
  select :'import_id'::uuid, source_row_num, paymentdate, pnr, parentorganizationcode, organizationcode, type, passenger_name, emailaddress, phone, bookingamount, bookingcurrency, accountamount, accountcurrency, balance, promocode, segmentcount, sourceusercode, req_number, column1, col_19, col_20, status from _stage_flyadeal_dxb_rows;
drop table _stage_flyadeal_dxb_rows;

-- === flyadeal_ksa (FlyAdeal KSA) — 4 rows ===
delete from flyadeal_ksa_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('flyadeal_ksa', 'Aviation 1 (2).xlsx', 'seed', 4)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_flyadeal_ksa_rows (source_row_num integer, createdusercode text, organizationcode text, parentorganizationcode text, recordlocator text, seat text, seatamount text, inft text, passengername text, emailaddress text, phone text, flightnumber text, departuredate text, legdetails text, pnrtotal text, baseyq text, basefare text, ssrfees text, cmf text, othercharge text, promotiondiscount text, discount text, pnrcurrency text, totalinorgcurrency text, status text, paxstatus text, organizationcurrency text, abca text, abcd text, ae text, chng text, d9 text, e3 text, eg text, eq text, exbg text, f25 text, f6 text, f7 text, fare text, gz text, hq text, io text, jk text, k7 text, balamce text, req_number text);
\copy _stage_flyadeal_ksa_rows(source_row_num, createdusercode, organizationcode, parentorganizationcode, recordlocator, seat, seatamount, inft, passengername, emailaddress, phone, flightnumber, departuredate, legdetails, pnrtotal, baseyq, basefare, ssrfees, cmf, othercharge, promotiondiscount, discount, pnrcurrency, totalinorgcurrency, status, paxstatus, organizationcurrency, abca, abcd, ae, chng, d9, e3, eg, eq, exbg, f25, f6, f7, fare, gz, hq, io, jk, k7, balamce, req_number) from 'seed_data/flyadeal_ksa_rows.csv' with (format csv, header true)
insert into flyadeal_ksa_rows (vendor_import_id, source_row_num, createdusercode, organizationcode, parentorganizationcode, recordlocator, seat, seatamount, inft, passengername, emailaddress, phone, flightnumber, departuredate, legdetails, pnrtotal, baseyq, basefare, ssrfees, cmf, othercharge, promotiondiscount, discount, pnrcurrency, totalinorgcurrency, status, paxstatus, organizationcurrency, abca, abcd, ae, chng, d9, e3, eg, eq, exbg, f25, f6, f7, fare, gz, hq, io, jk, k7, balamce, req_number)
  select :'import_id'::uuid, source_row_num, createdusercode, organizationcode, parentorganizationcode, recordlocator, seat, seatamount, inft, passengername, emailaddress, phone, flightnumber, departuredate, legdetails, pnrtotal, baseyq, basefare, ssrfees, cmf, othercharge, promotiondiscount, discount, pnrcurrency, totalinorgcurrency, status, paxstatus, organizationcurrency, abca, abcd, ae, chng, d9, e3, eg, eq, exbg, f25, f6, f7, fare, gz, hq, io, jk, k7, balamce, req_number from _stage_flyadeal_ksa_rows;
drop table _stage_flyadeal_ksa_rows;

-- === airarabia (Air Arabia ) — 18 rows ===
delete from airarabia_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('airarabia', 'Aviation 1 (2).xlsx', 'seed', 18)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_airarabia_rows (source_row_num integer, reference_code text, transaction_date text, debit_amount text, credit_amount text, balance text, remarks text, ticket_number text, custmoner_name text, user_id text, request_number text, column2 text, status text);
\copy _stage_airarabia_rows(source_row_num, reference_code, transaction_date, debit_amount, credit_amount, balance, remarks, ticket_number, custmoner_name, user_id, request_number, column2, status) from 'seed_data/airarabia_rows.csv' with (format csv, header true)
insert into airarabia_rows (vendor_import_id, source_row_num, reference_code, transaction_date, debit_amount, credit_amount, balance, remarks, ticket_number, custmoner_name, user_id, request_number, column2, status)
  select :'import_id'::uuid, source_row_num, reference_code, transaction_date, debit_amount, credit_amount, balance, remarks, ticket_number, custmoner_name, user_id, request_number, column2, status from _stage_airarabia_rows;
drop table _stage_airarabia_rows;

-- === flynas (FlyNas) — 19 rows ===
delete from flynas_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('flynas', 'Aviation 1 (2).xlsx', 'seed', 19)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_flynas_rows (source_row_num integer, date text, pnr2 text, pax text, amount text, req_number text, balance text, column6 text, status text);
\copy _stage_flynas_rows(source_row_num, date, pnr2, pax, amount, req_number, balance, column6, status) from 'seed_data/flynas_rows.csv' with (format csv, header true)
insert into flynas_rows (vendor_import_id, source_row_num, date, pnr2, pax, amount, req_number, balance, column6, status)
  select :'import_id'::uuid, source_row_num, date, pnr2, pax, amount, req_number, balance, column6, status from _stage_flynas_rows;
drop table _stage_flynas_rows;

-- === rts_ibtekar (RTS IBTKAR ) — 8 rows ===
delete from rts_ibtekar_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('rts_ibtekar', 'Aviation 1 (2).xlsx', 'seed', 8)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_rts_ibtekar_rows (source_row_num integer, col_1 text, pnr_creation_date text, record_locator text, officeid_bk text, officeid_tk text, signinbooking text, signinticketing text, passenger text, paxtype text, depdate text, arrdate text, numberofsegments text, fare_basis_es text, booking_class_es text, service_class_es text, route text, flight_numbers text, baggage text, date text, no text, carrier text, type text, action text, issue_type text, fare text, fare_currency text, net_fare text, fare_equiv text, fare_equiv_currency text, commission text, commission_equiv text, taxes text, taxes_currency text, sfdiscount text, hf text, service_fee text, sftotal text, markuptotal text, markupvat text, markupdiscount text, service_fee_vat text, total text, total_currency text, national_total text, national_currency text, misc_fees text, grand_total text, currency_rate text, fop text, document_credit_total text, sf_credit_total text, credit_currency text, credit_currency_rate text, booking_terminal_id text, ticketing_terminal_id text);
\copy _stage_rts_ibtekar_rows(source_row_num, col_1, pnr_creation_date, record_locator, officeid_bk, officeid_tk, signinbooking, signinticketing, passenger, paxtype, depdate, arrdate, numberofsegments, fare_basis_es, booking_class_es, service_class_es, route, flight_numbers, baggage, date, no, carrier, type, action, issue_type, fare, fare_currency, net_fare, fare_equiv, fare_equiv_currency, commission, commission_equiv, taxes, taxes_currency, sfdiscount, hf, service_fee, sftotal, markuptotal, markupvat, markupdiscount, service_fee_vat, total, total_currency, national_total, national_currency, misc_fees, grand_total, currency_rate, fop, document_credit_total, sf_credit_total, credit_currency, credit_currency_rate, booking_terminal_id, ticketing_terminal_id) from 'seed_data/rts_ibtekar_rows.csv' with (format csv, header true)
insert into rts_ibtekar_rows (vendor_import_id, source_row_num, col_1, pnr_creation_date, record_locator, officeid_bk, officeid_tk, signinbooking, signinticketing, passenger, paxtype, depdate, arrdate, numberofsegments, fare_basis_es, booking_class_es, service_class_es, route, flight_numbers, baggage, date, no, carrier, type, action, issue_type, fare, fare_currency, net_fare, fare_equiv, fare_equiv_currency, commission, commission_equiv, taxes, taxes_currency, sfdiscount, hf, service_fee, sftotal, markuptotal, markupvat, markupdiscount, service_fee_vat, total, total_currency, national_total, national_currency, misc_fees, grand_total, currency_rate, fop, document_credit_total, sf_credit_total, credit_currency, credit_currency_rate, booking_terminal_id, ticketing_terminal_id)
  select :'import_id'::uuid, source_row_num, col_1, pnr_creation_date, record_locator, officeid_bk, officeid_tk, signinbooking, signinticketing, passenger, paxtype, depdate, arrdate, numberofsegments, fare_basis_es, booking_class_es, service_class_es, route, flight_numbers, baggage, date, no, carrier, type, action, issue_type, fare, fare_currency, net_fare, fare_equiv, fare_equiv_currency, commission, commission_equiv, taxes, taxes_currency, sfdiscount, hf, service_fee, sftotal, markuptotal, markupvat, markupdiscount, service_fee_vat, total, total_currency, national_total, national_currency, misc_fees, grand_total, currency_rate, fop, document_credit_total, sf_credit_total, credit_currency, credit_currency_rate, booking_terminal_id, ticketing_terminal_id from _stage_rts_ibtekar_rows;
drop table _stage_rts_ibtekar_rows;

-- === ibtekar (ibtekar) — 265 rows ===
delete from ibtekar_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('ibtekar', 'Aviation 1 (2).xlsx', 'seed', 265)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_ibtekar_rows (source_row_num integer, date text, file_no text, doc_no text, col_4 text, ticket text, pnr text, issue_date text, lpo_no text, passenger text, sector text, debit text, credit text, balance text, travel_date text, return_date text, status text, col_17 text, mm text);
\copy _stage_ibtekar_rows(source_row_num, date, file_no, doc_no, col_4, ticket, pnr, issue_date, lpo_no, passenger, sector, debit, credit, balance, travel_date, return_date, status, col_17, mm) from 'seed_data/ibtekar_rows.csv' with (format csv, header true)
insert into ibtekar_rows (vendor_import_id, source_row_num, date, file_no, doc_no, col_4, ticket, pnr, issue_date, lpo_no, passenger, sector, debit, credit, balance, travel_date, return_date, status, col_17, mm)
  select :'import_id'::uuid, source_row_num, date, file_no, doc_no, col_4, ticket, pnr, issue_date, lpo_no, passenger, sector, debit, credit, balance, travel_date, return_date, status, col_17, mm from _stage_ibtekar_rows;
drop table _stage_ibtekar_rows;

-- === rts_dxb (RTS DXB) — 249 rows ===
delete from rts_dxb_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('rts_dxb', 'Aviation 1 (2).xlsx', 'seed', 249)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_rts_dxb_rows (source_row_num integer, pnr_creation_date text, record_locator text, passenger text, no text, col_5 text, action text, total text, total_currency text, national_total text, national_currency text, misc_fees text, grand_total text, currency_rate text, fop text, document_credit_total text, sf_credit_total text, credit_currency text, credit_currency_rate text, booking_terminal_id text, ticketing_terminal_id text);
\copy _stage_rts_dxb_rows(source_row_num, pnr_creation_date, record_locator, passenger, no, col_5, action, total, total_currency, national_total, national_currency, misc_fees, grand_total, currency_rate, fop, document_credit_total, sf_credit_total, credit_currency, credit_currency_rate, booking_terminal_id, ticketing_terminal_id) from 'seed_data/rts_dxb_rows.csv' with (format csv, header true)
insert into rts_dxb_rows (vendor_import_id, source_row_num, pnr_creation_date, record_locator, passenger, no, col_5, action, total, total_currency, national_total, national_currency, misc_fees, grand_total, currency_rate, fop, document_credit_total, sf_credit_total, credit_currency, credit_currency_rate, booking_terminal_id, ticketing_terminal_id)
  select :'import_id'::uuid, source_row_num, pnr_creation_date, record_locator, passenger, no, col_5, action, total, total_currency, national_total, national_currency, misc_fees, grand_total, currency_rate, fop, document_credit_total, sf_credit_total, credit_currency, credit_currency_rate, booking_terminal_id, ticketing_terminal_id from _stage_rts_dxb_rows;
drop table _stage_rts_dxb_rows;

-- === nsa (NSA) — 2785 rows ===
delete from nsa_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('nsa', 'Aviation 1 (2).xlsx', 'seed', 2785)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_nsa_rows (source_row_num integer, date text, notes text, event_month text, lpo_number text, operator_name text, request_number text, doc_no text, description text, pnr text, debit_sar text, credit_sar text, c_0utstanding_balances text, col_13 text, event_date text, reason_for_pending text);
\copy _stage_nsa_rows(source_row_num, date, notes, event_month, lpo_number, operator_name, request_number, doc_no, description, pnr, debit_sar, credit_sar, c_0utstanding_balances, col_13, event_date, reason_for_pending) from 'seed_data/nsa_rows.csv' with (format csv, header true)
insert into nsa_rows (vendor_import_id, source_row_num, date, notes, event_month, lpo_number, operator_name, request_number, doc_no, description, pnr, debit_sar, credit_sar, c_0utstanding_balances, col_13, event_date, reason_for_pending)
  select :'import_id'::uuid, source_row_num, date, notes, event_month, lpo_number, operator_name, request_number, doc_no, description, pnr, debit_sar, credit_sar, c_0utstanding_balances, col_13, event_date, reason_for_pending from _stage_nsa_rows;
drop table _stage_nsa_rows;

-- === goldmedal (goldmedal) — 6 rows ===
delete from goldmedal_rows;
with new_import as (
  insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
  values ('goldmedal', 'Aviation 1 (2).xlsx', 'seed', 6)
  returning id
)
select id as import_id from new_import \gset

create temporary table _stage_goldmedal_rows (source_row_num integer, customer_no text, name text, transaction_type text, invoice_number text, invoice_date text, col_6 text, passenger_name text, po_number text, curr text, original_amount text, balance_due text, status text, routing text, ticket_number text);
\copy _stage_goldmedal_rows(source_row_num, customer_no, name, transaction_type, invoice_number, invoice_date, col_6, passenger_name, po_number, curr, original_amount, balance_due, status, routing, ticket_number) from 'seed_data/goldmedal_rows.csv' with (format csv, header true)
insert into goldmedal_rows (vendor_import_id, source_row_num, customer_no, name, transaction_type, invoice_number, invoice_date, col_6, passenger_name, po_number, curr, original_amount, balance_due, status, routing, ticket_number)
  select :'import_id'::uuid, source_row_num, customer_no, name, transaction_type, invoice_number, invoice_date, col_6, passenger_name, po_number, curr, original_amount, balance_due, status, routing, ticket_number from _stage_goldmedal_rows;
drop table _stage_goldmedal_rows;

commit;

\echo 'Seed complete.'