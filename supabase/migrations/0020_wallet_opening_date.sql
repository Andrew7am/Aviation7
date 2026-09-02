-- An opening balance needs to know what it opened AGAINST.
--
-- A wallet's balance is its opening figure plus top-ups minus the tickets
-- drawn on it, and "the tickets drawn on it" meant every ticket that vendor
-- ever issued. That is right for a wallet opened when the ledger began, and
-- wrong for one opened today: adding an IATA balance of 817,284.78 immediately
-- subtracted 1,884 historical tickets worth 6.29 million, tickets that had
-- already been paid for long before this balance existed.
--
-- opening_date is the day the balance is true as of. Tickets before it are
-- already settled and are not drawn against it; tickets from that day onward
-- are.
--
-- NULL means what the column meant before it existed: count everything. Every
-- wallet already in the table keeps that behaviour, so no existing balance
-- moves by a single riyal when this is applied.

alter table vendor_balances
  add column if not exists opening_date date;

comment on column vendor_balances.opening_date is
  'The day the opening balance is true as of. Tickets dated before it were '
  'settled beforehand and are not charged to this wallet. NULL charges every '
  'ticket the vendor ever issued, which is the behaviour wallets had before '
  'this column existed.';
