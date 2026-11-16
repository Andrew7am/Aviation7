-- 0051 closing and reopening tickets, by office.
--
-- Only an admin writes (0019). The user, 16 Nov 2026: accounting6 may close
-- or reopen tickets, but only the Dubai office's. So an account may now carry
-- the offices whose tickets it can close or reopen, and nothing else it can
-- write. The office is read off the request number exactly as the app reads
-- it (src/core/helpers/reqOffice.ts): built-in prefixes and the ones added on
-- the Settings screen, longest first, then the code standing alone.
--
-- The check is here, not only on the screen: set_tickets_closed refuses the
-- whole call if any ticket in it belongs to another office or to none.

alter table public.app_users add column if not exists close_offices text[] not null default '{}';

create or replace function public.office_of(req text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  s text := upper(btrim(coalesce(req, '')));
  p record;
begin
  if s = '' then return ''; end if;
  for p in
    select pre, office from (
      select * from (values ('KSA', 'SAUDI'), ('UAE', 'DUBAI'), ('REQ', 'DUBAI'), ('RQE', 'DUBAI'),
                            ('DXB', 'DUBAI'), ('EGP', 'EGYPT'), ('SA', 'SAUDI')) b(pre, office)
      union all
      select upper(btrim(x.pre)), o.key
      from app_settings a
      cross join lateral jsonb_each(case when jsonb_typeof(a.value) = 'object' then a.value else '{}'::jsonb end) o
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(o.value) = 'array' then o.value else '[]'::jsonb end) x(pre)
      where a.key = 'offices' and btrim(x.pre) <> ''
    ) all_prefixes
    order by length(pre) desc
  loop
    if left(s, length(p.pre)) = p.pre then return p.office; end if;
  end loop;
  if s ~ '(^|[^A-Z])KSA([^A-Z]|$)' then return 'SAUDI'; end if;
  if s ~ '(^|[^A-Z])(UAE|DXB)([^A-Z]|$)' then return 'DUBAI'; end if;
  if s ~ '(^|[^A-Z])EGP([^A-Z]|$)' then return 'EGYPT'; end if;
  return '';
end;
$$;
revoke execute on function public.office_of(text) from anon, public;
grant execute on function public.office_of(text) to authenticated;

-- Close or reopen: an admin, any ticket; anyone else, only tickets of the
-- offices on their own row - all of them, or none is changed.
create or replace function public.set_tickets_closed(ids text[], to_closed boolean)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  me public.app_users%rowtype;
  outside integer;
  moved integer;
begin
  select * into me from public.app_users where id = auth.uid();
  if not found or me.role not in ('admin', 'accountant', 'aviation') then
    raise exception 'No access';
  end if;
  if me.role <> 'admin' then
    if coalesce(array_length(me.close_offices, 1), 0) = 0 then
      raise exception 'Not allowed to close or reopen tickets';
    end if;
    select count(*) into outside from public.tickets
      where id = any(ids) and not (public.office_of(req_num) = any(me.close_offices));
    if outside > 0 then
      raise exception '% of these tickets are not in your office (%)', outside, array_to_string(me.close_offices, ', ');
    end if;
  end if;
  update public.tickets set closed = to_closed where id = any(ids) and closed is distinct from to_closed;
  get diagnostics moved = row_count;
  return moved;
end;
$$;
revoke execute on function public.set_tickets_closed(text[], boolean) from anon, public;
grant execute on function public.set_tickets_closed(text[], boolean) to authenticated;

-- Its own row tells the app what to offer.
update public.app_users set close_offices = '{DUBAI}' where email = 'accounting6@luxuryexplorersme.com';
