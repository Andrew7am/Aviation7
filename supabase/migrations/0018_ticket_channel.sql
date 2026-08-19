-- 0018 channel (settlement sub-source) on tickets
--
-- IATA settles through more than one channel. BSP and WEBSALES-EDIS appear on
-- the same invoice, under the same vendor, and must stay distinguishable for
-- reconciliation — but WEBSALES-EDIS is NOT a separate vendor and must not
-- become one, or it would fragment IATA's transaction tracking.
--
-- `source` already carries the vendor ("IATA BSP"), and vendor↔wallet matching
-- keys off it, so overloading it with the channel would silently change which
-- wallet a row belongs to. A separate nullable column keeps the three concepts
-- apart — vendor (source), channel, document type (transaction_type) — without
-- touching how any existing row is interpreted.
--
-- Additive and nullable by design: every existing ticket, for every vendor,
-- keeps channel NULL and behaves exactly as before.

set search_path = public;

alter table tickets add column if not exists channel text;

comment on column tickets.channel is
  'Settlement channel within a vendor (e.g. BSP, WEBSALES-EDIS for IATA). '
  'NULL for vendors that settle through a single channel. Never used for '
  'vendor/wallet matching — that remains keyed on source.';

-- Reconciliation reads IATA rows by channel; nothing else filters on it.
create index if not exists tickets_channel_idx on tickets(source, channel)
  where channel is not null;
