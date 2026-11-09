-- 0049 roles and access: accountants and the aviation team only.
--
-- Until now every signed-in account could read every table - real costs,
-- supplier balances, the team's sheet - and every new sign-up became a
-- member that could too. Operations are to see none of it: the aviation
-- team quotes them a cost, and the real one stays here (9 Nov 2026).
--
--   admin       everything, and the only role that writes (unchanged)
--   accountant  reads everything
--   aviation    reads everything (their own profit page comes next)
--   pending     a new account: reads nothing until an admin gives it a role
--
-- Read access is no longer "any signed-in user" but has_access().

create or replace function public.has_access()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from app_users where id = auth.uid() and role in ('admin', 'accountant', 'aviation'));
$$;
revoke execute on function public.has_access() from anon, public;
grant execute on function public.has_access() to authenticated;

alter table public.app_users drop constraint if exists app_users_role_check;
update public.app_users set role = 'accountant' where role = 'member' and email ilike 'accounting%';
update public.app_users set role = 'aviation'   where role = 'member' and email ilike 'ticketing%';
update public.app_users set role = 'pending'    where role = 'member';
alter table public.app_users add constraint app_users_role_check
  check (role in ('admin', 'accountant', 'aviation', 'pending'));
alter table public.app_users alter column role set default 'pending';

-- A new account starts with no access.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into app_users (id, email, role)
  values (new.id, coalesce(new.email, ''), 'pending')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Every policy that let any signed-in account in now asks has_access().
do $$
declare p record;
begin
  for p in select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    if p.qual in ('true', '(auth.role() = ''authenticated''::text)') then
      execute format('alter policy %I on public.%I using (public.has_access())', p.policyname, p.tablename);
    end if;
    if p.with_check in ('true', '(auth.role() = ''authenticated''::text)') then
      execute format('alter policy %I on public.%I with check (public.has_access())', p.policyname, p.tablename);
    end if;
  end loop;
end $$;

-- Everyone may read their own row, so the app can say "no access" rather than show empty screens.
drop policy if exists app_users_self_read on public.app_users;
create policy app_users_self_read on public.app_users for select to authenticated using (id = auth.uid());

-- Open to the public API with no protection at all (Supabase advisor, 5 Nov).
alter table public.schema_migrations enable row level security;
