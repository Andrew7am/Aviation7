-- 0032 ticket_original_currency: a ticket bought in dollars, kept in dirhams.
--
-- Tickets bought on an airline's own website are paid in whatever the site
-- charges — dollars, mostly — and the books are kept in dirhams. So a dollar
-- ticket is recorded converted, at 3.67, and these say what it was before:
-- the currency and figure the team's sheet and the airline's receipt show,
-- and the rate it was converted at. Anyone comparing against their sheet
-- needs the original; anyone adding up the books needs the dirhams.
--
-- Empty on every ticket recorded in its own currency.

set search_path = public;

alter table tickets add column if not exists original_currency text;
alter table tickets add column if not exists original_amount   numeric(14,2);
alter table tickets add column if not exists fx_rate           numeric(10,4);

comment on column tickets.original_currency is
  'The currency the ticket was bought in, when it was converted on the way into the books (USD -> AED at 3.67). Null when recorded as bought.';
comment on column tickets.original_amount is
  'The amount in original_currency, as the receipt and their sheet show it.';
comment on column tickets.fx_rate is
  'The rate original_amount was multiplied by to give amount.';
