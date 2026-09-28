-- 0030 tickets.related_ticket: the ticket a refund refunds.
--
-- BSP prints a refund as a document line of its own, and the line after it
-- names what it refunds:
--
--     065 RFND 0079527503 01APR26 ... -2,600.00
--         +RTDN: 2195858830 1000 0.00
--
-- RTDN is "Related Ticket Document Number". The parser read the RFND line
-- and never the RTDN beneath it, so a refund arrived as money coming back
-- against nothing in particular.
--
-- For most refunds that did no harm, because BSP files them under the
-- ticket's own number — 349 of the 363 on the billing files carry it. The
-- other fourteen are refund applications with a document number of their
-- own, and those were filed under that number and tied to nothing. One sits
-- in the ledger with a request number of "REFNDAPPLICATION": somebody could
-- see it was a refund, could not see what it refunded, and typed that in.
--
-- This records the link as the document states it. It does not replace the
-- refund's own number, which is the refund application BSP issued and the
-- number anybody will be quoted on the phone — it sits beside it.

set search_path = public;

alter table tickets add column if not exists related_ticket text;

create index if not exists tickets_related_ticket_idx
  on tickets (related_ticket) where related_ticket is not null;

comment on column tickets.related_ticket is
  'For a refund: the ticket it refunds, as BSP''s +RTDN line names it. The refund keeps its own document number in ticket_no.';
