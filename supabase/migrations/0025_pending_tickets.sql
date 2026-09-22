-- 0025 pending_tickets: tickets the team-sheet check found and nobody has
-- agreed to yet.
--
-- The check reads the aviation team's sheet against our ledger and comes back
-- with a couple of hundred tickets that are on their sheet and in nobody's
-- books. Every one of them probably belongs in the ledger, and not one of them
-- should go in on the say-so of a comparison: their currency, their idea of
-- the request number and their price are all theirs, and a ticket taken from
-- it whole is a ticket nobody checked. Writing them straight into `tickets`
-- would also move every vendor balance the moment a file was uploaded.
--
-- So they land here instead. A pending ticket is a PROPOSAL: the ticket as it
-- would be recorded, beside the evidence for it — which of their portals sold
-- it, which request their sheet files it under, what the check concluded. It
-- touches no balance and appears in no report. Somebody reads it, fixes what
-- is wrong, and confirms it, and confirming is what writes the ticket.
--
-- WHY A ROW STAYS BEHIND
--
-- Ibtekar and NSA bill us on a statement that is imported whole and settles
-- against a credit wallet. A ticket of theirs keyed in by hand would move that
-- wallet twice — once now and once when the statement arrives — and the
-- balance would be wrong by the price of the ticket until somebody found it.
-- Those rows are carried here so they can be seen and counted, flagged
-- `held_back`, and the confirm button is closed on them. They arrive when
-- their statement does.
--
-- IDEMPOTENT BY CONSTRUCTION
--
-- The same sheet gets checked several times before it is signed off. `dedupe`
-- is what the proposal is ABOUT — its origin, the document, and the finding —
-- so a second run updates the row it already raised instead of raising it
-- again, and a row somebody has already confirmed or rejected is left exactly
-- as they left it.

set search_path = public;

create table if not exists pending_tickets (
  id               text primary key,
  user_id          uuid not null,

  -- === the ticket, as it would be recorded ===
  ticket_no        text not null default '',
  source           text not null default '',
  date             text not null default '',
  amount           numeric not null default 0,
  commission       numeric not null default 0,
  total_doc        numeric not null default 0,
  req_num          text not null default '',
  pnr              text,
  passenger_name   text,
  airline_code     text,
  route            text,
  status           text,
  currency         text default 'AED',
  transaction_type text,
  vendor_reference text,

  -- === where it came from, and what was concluded ===
  -- Always 'TEAM_SHEET' today. Named rather than assumed, because the next
  -- thing that wants a review queue will not be the team sheet.
  origin           text not null default 'TEAM_SHEET',
  -- Their "Portal" column, their word for it.
  their_portal     text,
  -- The request THEIR sheet files it under, kept apart from req_num so the
  -- reviewer can see what was proposed and what it was proposed from.
  their_req        text,
  -- Their own "Net Cost", kept beside `amount` after being copied into it.
  -- It is a genuine net -- their marked-up rate lives in a column of its
  -- own that is never read -- and it matches ours exactly about two times
  -- in three. Keeping it lets the screen tell a figure nobody has checked
  -- from one somebody corrected.
  their_cost       numeric,
  -- How many tickets shared the cell their_cost came from.
  --
  -- 1 means the figure is this ticket's and was copied into `amount`.
  -- More means it is the BOOKING'S: 123 of the first 206 proposals came
  -- out of a shared cell, one of them holding 45 tickets against 139,500
  -- AED. Those arrive unpriced, and this is what tells the reviewer what
  -- they are dividing.
  their_group      integer not null default 1,
  -- The check's verdict, e.g. NOT_IN_LEDGER, REFUND_NOT_IN_LEDGER.
  finding          text,
  -- The sentence the check wrote, in the reader's own terms.
  note             text,
  held_back        boolean not null default false,
  held_back_why    text,

  -- === review ===
  -- PENDING | CONFIRMED | REJECTED
  state            text not null default 'PENDING',
  -- What the reviewer wrote when they rejected it, or changed on the way in.
  review_note      text,
  reviewed_at      timestamptz,
  reviewed_by      uuid,
  -- The ticket it became, so a confirmed proposal points at its own result.
  ticket_id        text,

  dedupe           text not null,
  created_at       timestamptz not null default now(),

  constraint pending_tickets_state
    check (state in ('PENDING', 'CONFIRMED', 'REJECTED')),
  constraint pending_tickets_dedupe unique (dedupe)
);

create index if not exists pending_tickets_state_idx
  on pending_tickets (state, created_at desc);
create index if not exists pending_tickets_source_idx
  on pending_tickets (source) where state = 'PENDING';

alter table pending_tickets enable row level security;

-- Same split as every other table since 0019: the workspace reads, admins
-- write. A viewer can see what is waiting; only an admin can confirm it.
drop policy if exists pending_tickets_read        on pending_tickets;
drop policy if exists pending_tickets_admin_write on pending_tickets;

create policy pending_tickets_read on pending_tickets
  for select to authenticated using (true);
create policy pending_tickets_admin_write on pending_tickets
  for all to authenticated using (is_admin()) with check (is_admin());

-- The screen has to move a row from Waiting to Recorded the moment somebody
-- confirms it, and two people review the same queue. Added to realtime for
-- the same reason `tickets` is.
do $$
begin
  alter publication supabase_realtime add table pending_tickets;
exception when duplicate_object then null;
end $$;
