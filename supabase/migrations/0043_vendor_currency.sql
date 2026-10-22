-- Every ticket is in its vendor's currency.
--
-- The user set it (22 Oct 2026): a vendor bills in one currency, and a ticket
-- of theirs is in that currency whatever a sheet or a form says. The team
-- sheet had put NSA's refund of 4861731806 in AED and RTS sales in SAR, and
-- the ticket list then totalled them under the wrong currency.
--
-- The same rule as vendorCurrency() in src/core/helpers/sourceCurrency.ts -
-- a vendor added to AED_KEYS there is added here too. A purchase on an
-- airline's website keeps its own currency (it is whatever the site charged).

create or replace function public.vendor_currency(src text) returns text
language sql immutable as $$
  select case
    when coalesce(btrim(src), '') = '' or lower(btrim(src)) = 'airline website' then null
    when lower(src) ~ '(iata|rts|flyadeal dxb|air arabia|airarabia|flydubai|fly dubai|riyadh air|riyadhair|turkish|emirates|websales)' then 'AED'
    else 'SAR'
  end
$$;

create or replace function public.tickets_vendor_currency() returns trigger
language plpgsql as $$
begin
  new.currency := coalesce(public.vendor_currency(new.source), new.currency);
  return new;
end
$$;

drop trigger if exists tickets_vendor_currency on public.tickets;
create trigger tickets_vendor_currency before insert or update of currency, source on public.tickets
  for each row execute function public.tickets_vendor_currency();
