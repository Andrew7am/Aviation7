-- 0029 void_tickets.period must not be null.
--
-- The table is kept from duplicating on (ticket_no, source, period), and in
-- Postgres two NULLs are never equal — so a unique constraint does not see
-- them as the same row. BSP's files carry a period and the 334 already on
-- file all have one, but every other supplier's does not, and those would
-- have arrived again on every re-import with the constraint silently
-- standing aside. A void ratio counted twice is the single number this
-- table exists to get right.
--
-- So the column is required. Where a supplier states no period, the writer
-- puts the document's own month in it — which is what the ratio is grouped
-- by anyway, and is stable across re-imports of the same file.

set search_path = public;

update void_tickets set period = coalesce(nullif(period, ''), to_char(date, 'YYYY-MM'), '')
 where period is null or period = '';

alter table void_tickets alter column period set default '';
alter table void_tickets alter column period set not null;

comment on column void_tickets.period is
  'The supplier''s own billing period where it has one, otherwise the document''s month. Never null: the de-duplication key depends on it.';
