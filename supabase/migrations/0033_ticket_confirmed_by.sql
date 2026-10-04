-- 0033 ticket_confirmed_by: which supplier document confirmed a row we
-- first recorded from the team's sheet or by hand.
--
-- 7,025.00 on 5513408117 went into the books from their sheet as an RTS
-- refund, and RTS's own report never showed it. Nothing said so: a row
-- typed from their sheet and a row read from the supplier look the same in
-- the ledger. When a supplier's report later carries the same document at
-- the same amount, the row is confirmed and says by what; until then it is
-- unconfirmed, and a request holding one is not ready to close.
--
-- report_name keeps where the row came FROM. This says what has since
-- vouched for it.

set search_path = public;

alter table tickets add column if not exists confirmed_by text;
alter table tickets add column if not exists confirmed_at timestamptz;

comment on column tickets.confirmed_by is
  'The supplier report that carried this row at the same amount, for a row first recorded from the team sheet or by hand.';
