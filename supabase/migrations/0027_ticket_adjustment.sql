-- 0027 tickets.adjustment: money added to a ticket that its vendor's own
-- document does not carry.
--
-- Fourteen Ibtekar tickets hold about ten riyals more than Ibtekar's movement
-- sheet bills for the same document, and the rule behind them is exact rather
-- than approximate: every one of them is the sheet's figure plus ten, rounded
-- to the whole riyal.
--
--     711.85 + 10 = 721.85  ->    722.00
--   1,607.70 + 10 = 1,617.70 ->  1,618.00
--   6,118.00 + 10 = 6,128.00 ->  6,128.00
--
-- Nobody edited their amount by hand — the audit log has forty edits against
-- these rows and not one touches the money — so it arrived with the import
-- and has been sitting in the ledger since, unmarked and indistinguishable
-- from a price the vendor charged.
--
-- WHY A COLUMN AND NOT A LIST
--
-- These rows have to be settled one at a time with the client they belong to,
-- over weeks. Moving them to a screen of their own would take them out of
-- every total they are part of and make the ledger disagree with itself while
-- the conversation ran. They stay exactly where they are; this column says
-- which they are and how much of each is the addition, so they can be found,
-- filtered, discussed and — one by one — cleared.
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
  'Money in this row that the vendor''s own document does not bill. Null = nothing added; never 0 for "unchecked".';
comment on column tickets.adjustment_note is
  'Why it is here, in the words of whoever established it.';
