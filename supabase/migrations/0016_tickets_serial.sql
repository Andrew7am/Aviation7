-- 0016 tickets.serial: IATA BSP's "Serial" column — a running sequence number
-- in the vendor's own report. Lets the user spot gaps (missing tickets) by
-- checking for skips in the sequence. Only populated for vendors whose
-- report actually has one (IATA today); null everywhere else.

set search_path = public;

alter table tickets add column if not exists serial integer;
create index if not exists tickets_serial_idx on tickets(user_id, serial);
