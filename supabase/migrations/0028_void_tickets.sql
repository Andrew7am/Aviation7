-- 0028 void_tickets: the documents that were cancelled, kept apart.
--
-- A void moves no money. That is why the import has always dropped them —
-- a ledger row worth nothing is noise in every total it touches, and three
-- of them once sat in the books as live sales because somebody stored a
-- cancellation as a ticket.
--
-- But dropping them was right for the ledger and wrong for the agency. IATA
-- caps how much of a year's issuance may be voided, and that ratio cannot be
-- worked out from documents nobody kept. Read back out of the BSP invoices,
-- 334 of 1,901 documents were cancelled: 17.57%, and single periods as high
-- as 45%.
--
-- So they live here instead. Apart from `tickets` on purpose: nothing here
-- is in any balance, any request's cost, any statement comparison or any
-- report of money. It is a register of paper, not of value.
--
-- WHY THERE IS NO REQUEST NUMBER AND NO CLOSED FLAG
--
-- Both would be lies. A request number says which job a cost belongs to,
-- and a void has no cost to belong to anything. `closed` says a figure has
-- been settled with the client, and there is no figure. Worse, they would
-- invite the row into screens built for money — Not Closed, Requests, the
-- outstanding totals — which is exactly the mixing this table exists to
-- prevent.
--
-- A void is findable, countable, and nothing else.
--
-- WHY THE FACE VALUE IS HERE ANYWAY
--
-- What the document WOULD have been worth, as the invoice printed it before
-- it was cancelled. Never a balance and never summed into one; it is there
-- because "we voided 94 documents last period" and "we voided 94 documents
-- worth 380,000" are different sentences to the person who has to explain
-- the ratio.

set search_path = public;

create table if not exists void_tickets (
  id             text primary key,
  user_id        uuid not null,

  -- The document, as it is everywhere else: airline prefix kept apart from
  -- the serial so the same matching works against the ledger.
  ticket_no      text not null,
  airline_code   text,
  pnr            text,
  passenger_name text,

  -- When the document was issued. A void is dated by the thing it cancels,
  -- not by the cancellation: that is the date anybody searches by.
  date           date,

  source         text not null,
  -- The billing period it was reported in — "260804". The ratio is asked
  -- period by period, and a date alone cannot give it: BSP's periods are
  -- four to a month and do not line up with one.
  period         text,

  currency       text,
  -- What it would have been worth. Context, never a balance.
  face_value     numeric(14,2),

  -- CANX, CANN, VOID — as the source printed it. Two cancellation codes
  -- that mean slightly different things to BSP should not be flattened on
  -- the way in; nobody can get them back afterwards.
  raw_status     text,

  report_name    text,
  note           text,
  import_time    timestamptz,
  created_at     timestamptz not null default now(),

  -- The same document can be cancelled once per period and reported in more
  -- than one file. This is what makes re-importing an invoice safe.
  constraint void_tickets_once unique (ticket_no, source, period)
);

create index if not exists void_tickets_ticket_idx on void_tickets (ticket_no);
create index if not exists void_tickets_date_idx   on void_tickets (date desc);
create index if not exists void_tickets_period_idx on void_tickets (source, period);

alter table void_tickets enable row level security;

drop policy if exists void_tickets_read        on void_tickets;
drop policy if exists void_tickets_admin_write on void_tickets;

create policy void_tickets_read on void_tickets
  for select to authenticated using (true);
create policy void_tickets_admin_write on void_tickets
  for all to authenticated using (is_admin()) with check (is_admin());

comment on table void_tickets is
  'Cancelled documents. In no balance and no request — kept so the void ratio can be counted.';
