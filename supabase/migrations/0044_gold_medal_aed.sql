-- Gold Medal bills in AED (the user, 22 Oct 2026). Same list as AED_KEYS in
-- src/core/helpers/sourceCurrency.ts; the trigger from 0043 then holds every
-- Gold Medal ticket to it.

create or replace function public.vendor_currency(src text) returns text
language sql immutable as $$
  select case
    when coalesce(btrim(src), '') = '' or lower(btrim(src)) = 'airline website' then null
    when lower(src) ~ '(iata|rts|gold medal|goldmedal|flyadeal dxb|air arabia|airarabia|flydubai|fly dubai|riyadh air|riyadhair|turkish|emirates|websales)' then 'AED'
    else 'SAR'
  end
$$;
