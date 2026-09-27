-- 0027 tickets.adjustment: what a row's Balance Payable carries above its
-- own Fare.
--
-- Twenty-one Ibtekar rows do this, by about ten riyals each, and no other
-- vendor in the ledger does it at all:
--
--     fare    711.85   payable    722.00
--     fare  1,791.70   payable  1,803.00
--     fare  5,618.90   payable  5,629.00
--
-- Where a tax invoice prices one of them the invoice agrees with the PAYABLE,
-- so the charge is Ibtekar's and the Fare column is the ticket before it was
-- added. Nobody edited these by hand: the audit log carries forty edits
-- against them and not one touches the money, so it arrived with the import.
--
-- WHY THE TEST IS INSIDE THE ROW
--
-- The first version of this asked a different question — the ledger against
-- Ibtekar's movement sheet — and found fourteen rows ten riyals apart. The
-- tax invoices then showed the ledger agreeing with the invoice to the fil on
-- every one of them, so it was the SHEET that was short and there was nothing
-- to settle. Eleven of those fourteen also looked identical on screen, their
-- Fare and Balance Payable the same number, which is how the wrong question
-- announced itself.
--
-- Fare against Payable needs no second document. That is what makes it usable
-- across August and September, which the movement sheet does not reach.
--
-- WHY A COLUMN AND NOT A LIST
--
-- These rows get settled one at a time, over weeks. Moving them to a screen
-- of their own would take them out of every total they are part of and make
-- the ledger disagree with itself while the conversation ran. They stay where
-- they are; this column says which they are and how much of each sits above
-- the fare, so they can be found, filtered and — one by one — cleared.
--
-- Null means nothing was added. It is not zero: zero would be a claim that
-- somebody checked and found nothing, and almost no row has been checked.

set search_path = public;

alter table tickets add column if not exists adjustment      numeric(14,2);
alter table tickets add column if not exists adjustment_note text;

-- The screen filters on "has an adjustment", which is a small slice of a
-- large table.
create index if not exists tickets_adjustment_idx
  on tickets (source, date) where adjustment is not null;

comment on column tickets.adjustment is
  'What this row''s Balance Payable carries above its own Fare. Null = nothing added; never 0 for "unchecked".';
comment on column tickets.adjustment_note is
  'Why it is here, in the words of whoever established it.';
