-- One name for IATA: "IATA BSP".
--
-- The user (5 Nov 2026): every IATA ticket under one vendor. The vendor lists
-- offered "IATA", the wallet's name, beside "IATA BSP", what every BSP row is
-- filed under, and ADPIJR went in from To Review under the bare name on
-- 2 Nov - a second vendor to every report that groups by source. The lists
-- no longer offer it (sources.ts); this makes it impossible for a ticket
-- whatever screen or script writes it. The wallet stays "IATA": it is the
-- account, and it draws on these rows by name.

create or replace function public.tickets_vendor_currency() returns trigger
language plpgsql as $$
begin
  if lower(btrim(coalesce(new.source, ''))) = 'iata' then
    new.source := 'IATA BSP';
  end if;
  new.currency := coalesce(public.vendor_currency(new.source), new.currency);
  return new;
end
$$;

update public.tickets set source = 'IATA BSP' where lower(btrim(source)) = 'iata';
update public.pending_tickets set source = 'IATA BSP' where lower(btrim(source)) = 'iata';

notify pgrst, 'reload schema';
