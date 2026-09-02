-- What cabin a ticket was sold in.
--
-- The agency needs to see what it actually issues and on which airlines: a
-- hundred economy seats and a hundred business seats are not the same business
-- even when the ticket counts match.
--
-- Two columns, because one of them cannot be trusted to be complete. cabin_raw
-- keeps what the source called it, verbatim — "Business; Prestige", "fly+",
-- "Economy; Main Cabin" — and cabin_class holds the reading of it, one of
-- FIRST, BUSINESS, PREMIUM_ECONOMY, ECONOMY. Names that state no cabin are
-- left NULL in cabin_class while their text survives in cabin_raw, so a brand
-- name nobody has mapped yet can be named later instead of being guessed at
-- now and quietly counted as the wrong thing.

alter table tickets
  add column if not exists cabin_class text,
  add column if not exists cabin_raw   text;

alter table tickets
  drop constraint if exists tickets_cabin_class_check;
alter table tickets
  add constraint tickets_cabin_class_check
  check (cabin_class is null
         or cabin_class in ('FIRST', 'BUSINESS', 'PREMIUM_ECONOMY', 'ECONOMY'));

create index if not exists tickets_cabin_class_idx
  on tickets (cabin_class) where cabin_class is not null;

comment on column tickets.cabin_class is
  'FIRST | BUSINESS | PREMIUM_ECONOMY | ECONOMY, read from cabin_raw. NULL '
  'when the source said nothing, said it could not tell, or used a brand name '
  'that states no cabin.';
comment on column tickets.cabin_raw is
  'The cabin exactly as the source wrote it, including mixed journeys such as '
  '"Economy; Business". Kept so a reading can be revisited without the source.';
