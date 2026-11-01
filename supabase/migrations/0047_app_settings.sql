-- Settings an admin changes on the Settings screen, not in the code.
--
-- The user (1 Nov 2026): "when I add a new vendor, or change something like
-- I ask you to, I want to do it myself". Until now a vendor's currency, the
-- Emirates weekly limit and the request alerts were all written in the code
-- or in a migration. Each key holds one setting as JSON:
--
--   vendors         [{ "name": "Saudia Direct", "currency": "SAR" }, ...]
--                   added vendors, and any vendor's currency set by hand -
--                   read before the built-in rule.
--   airline_limits  [{ "airlineCode": "176", "airline": "Emirates",
--                      "limit": 400000, "warnAt": 390000, "currency": "AED",
--                      "weekFrom": "2026-10-26" }]
--
-- Everyone signed in reads them; only an admin writes them.

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);
drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
  for all to authenticated using (is_admin()) with check (is_admin());

insert into public.app_settings (key, value, updated_by) values
  ('vendors', '[]'::jsonb, 'migration 0047'),
  ('airline_limits', '[{"airlineCode":"176","airline":"Emirates","limit":400000,"warnAt":390000,"currency":"AED","weekFrom":"2026-10-26"}]'::jsonb, 'migration 0047')
on conflict (key) do nothing;

-- Request alerts are set on the same screen: an admin adds, changes and
-- removes them (0045 let everyone read them and nobody write).
drop policy if exists request_alerts_admin_write on public.request_alerts;
create policy request_alerts_admin_write on public.request_alerts
  for all to authenticated using (is_admin()) with check (is_admin());

-- A vendor's currency: the one set on the Settings screen first, then the
-- built-in rule (0043, 0044). Stable rather than immutable now that it reads
-- a table.
create or replace function public.vendor_currency(src text) returns text
language sql stable as $$
  select case
    when coalesce(btrim(src), '') = '' or lower(btrim(src)) = 'airline website' then null
    else coalesce(
      (select upper(v->>'currency') from public.app_settings s, jsonb_array_elements(s.value) v
        where s.key = 'vendors' and lower(btrim(v->>'name')) = lower(btrim(src))
          and coalesce(v->>'currency', '') <> '' limit 1),
      case
        when lower(src) ~ '(iata|rts|gold medal|goldmedal|flyadeal dxb|air arabia|airarabia|flydubai|fly dubai|riyadh air|riyadhair|turkish|emirates|websales)' then 'AED'
        else 'SAR'
      end)
  end
$$;

notify pgrst, 'reload schema';
