-- 0031 ticket_exchanges: which document replaced which.
--
-- A ticket has a history. It is issued, reissued into a second document —
-- with money or without — reissued again, and refunded. BSP prints each
-- reissue as a sale whose RTDN names the ticket it replaces, marked EX:
--
--     065 TKTT 5512129174 19MAR26 ... 20.00
--         +RTDN: 5512129165 1234 EX 0.00
--
-- and a refund names whichever link it refunds. On the billing files 27 of
-- 363 refunds name a reissue, and a reissue is often only the change fee:
-- 20.00 against a refund of 48,890, because the 51,550 sits on the original.
-- Without the chain, that refund looks like money coming back that was never
-- paid; with it, it is an ordinary refund less a penalty.
--
-- WHY A TABLE AND NOT A COLUMN
--
-- A reissue that moved no money is not in the ledger at all — the parser
-- drops even exchanges, because a row that carries nothing can never be
-- closed. But the link it forms is real, and two refunds name exactly such a
-- reissue: their originals sit in the books, and the one document that would
-- connect them was thrown away. The relation between two documents is a fact
-- whether or not either one carries money, so it is kept apart from the
-- money, in the same way the void register is.
--
-- It is a record of paper: nothing here is in a balance.

set search_path = public;

create table if not exists ticket_exchanges (
  -- The new document, and the one it replaced. Ten-digit serials.
  ticket_no        text not null,
  replaced_ticket  text not null,
  airline_code     text,
  source           text not null,
  date             date,
  -- The BSP billing period it was reported in.
  period           text not null default '',
  -- What the reissue collected: 0 for an even exchange.
  fee              numeric(14,2),
  report_name      text,
  created_at       timestamptz not null default now(),

  -- A document replaces exactly one other, once. This is what makes
  -- re-reading a billing file safe.
  primary key (ticket_no, source)
);

create index if not exists ticket_exchanges_replaced_idx on ticket_exchanges (replaced_ticket);

alter table ticket_exchanges enable row level security;
drop policy if exists ticket_exchanges_read        on ticket_exchanges;
drop policy if exists ticket_exchanges_admin_write on ticket_exchanges;
create policy ticket_exchanges_read on ticket_exchanges
  for select to authenticated using (true);
create policy ticket_exchanges_admin_write on ticket_exchanges
  for all to authenticated using (is_admin()) with check (is_admin());

comment on table ticket_exchanges is
  'Reissues: which document replaced which. Kept for zero-value reissues too, which are not in the ledger.';
