-- 0017 shared workspace + admin audit trail
--
-- Two changes:
--
-- 1. ACCESS. Until now every table was scoped to the owning user
--    (auth.uid() = user_id), so a second person signing up saw an empty
--    system. The agency works off ONE shared book of tickets, so any
--    authenticated user now reads and writes the whole dataset. user_id is
--    kept on every row as "who created this", not as an access boundary.
--
-- 2. ACCOUNTABILITY. Because everyone can now edit everything, every
--    mutation has to be attributable. audit_log gains the actor's id and
--    email, and ticket changes are recorded by a DATABASE TRIGGER rather
--    than by the client — a trigger cannot be skipped by a caller that
--    forgets to log, or bypassed from the browser console.
--
--    Reading the audit log is restricted to admins.

set search_path = public;

-- ── app_users: registry of everyone who has signed up ────────────────────
create table if not exists app_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- Backfill anyone who already signed up before this migration.
insert into app_users (id, email, role)
select u.id, coalesce(u.email, ''), 'member'
from auth.users u
on conflict (id) do nothing;

-- Auto-register future signups.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_users (id, email, role)
  values (new.id, coalesce(new.email, ''), 'member')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- is_admin() is SECURITY DEFINER so it can read app_users without tripping
-- that table's own RLS (which would recurse when used inside a policy).
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Shared-workspace RLS ─────────────────────────────────────────────────
-- Replace the per-owner policies with "any authenticated user".
drop policy if exists tickets_owner         on tickets;
drop policy if exists vendor_balances_owner on vendor_balances;
drop policy if exists balance_topups_owner  on balance_topups;
drop policy if exists import_history_owner  on import_history;
drop policy if exists error_log_owner       on error_log;
drop policy if exists audit_log_owner       on audit_log;

create policy tickets_shared on tickets
  for all to authenticated using (true) with check (true);

create policy vendor_balances_shared on vendor_balances
  for all to authenticated using (true) with check (true);

create policy balance_topups_shared on balance_topups
  for all to authenticated using (true) with check (true);

create policy import_history_shared on import_history
  for all to authenticated using (true) with check (true);

create policy error_log_shared on error_log
  for all to authenticated using (true) with check (true);

-- app_users: everyone signed in can see who else has access (so the admin
-- screen can name people), but only admins may change roles.
alter table app_users enable row level security;

drop policy if exists app_users_read        on app_users;
drop policy if exists app_users_admin_write on app_users;

create policy app_users_read on app_users
  for select to authenticated using (true);

create policy app_users_admin_write on app_users
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── Audit log ────────────────────────────────────────────────────────────
alter table audit_log add column if not exists actor_id     uuid;
alter table audit_log add column if not exists actor_email  text;
alter table audit_log add column if not exists entity_type  text;
alter table audit_log add column if not exists before_data  jsonb;
alter table audit_log add column if not exists after_data   jsonb;

create index if not exists audit_log_performed_at_idx on audit_log(performed_at desc);
create index if not exists audit_log_actor_idx        on audit_log(actor_id, performed_at desc);

-- Only admins read the audit log. Inserts stay open to authenticated users
-- so the app (and the triggers below) can always write a record.
create policy audit_log_admin_read on audit_log
  for select to authenticated using (is_admin());

create policy audit_log_insert on audit_log
  for insert to authenticated with check (true);

-- ── Ticket change trigger ────────────────────────────────────────────────
-- Records UPDATE and DELETE against tickets with the acting user's identity
-- and a field-level before/after diff. INSERTs are deliberately not logged
-- row-by-row: a bulk import would write thousands of near-identical entries
-- and import_history already records imports at batch level.
create or replace function log_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor      uuid := auth.uid();
  actor_mail text;
  changed    jsonb := '{}'::jsonb;
  old_vals   jsonb := '{}'::jsonb;
  col        text;
  old_v      text;
  new_v      text;
begin
  select email into actor_mail from app_users where id = actor;

  if tg_op = 'DELETE' then
    insert into audit_log (id, user_id, actor_id, actor_email, action, entity_type, entity, detail, before_data)
    values (
      'aud_' || replace(gen_random_uuid()::text, '-', ''),
      coalesce(old.user_id, actor), actor, coalesce(actor_mail, 'system'),
      'DELETE', 'ticket', old.ticket_no,
      format('Deleted %s ticket %s (%s %s)', old.source, old.ticket_no, old.amount, coalesce(old.currency, '')),
      to_jsonb(old)
    );
    return old;
  end if;

  -- UPDATE: diff only the columns a person can actually edit, so noise like
  -- import_time or is_duplicate recalculation doesn't create audit entries.
  foreach col in array array[
    'ticket_no','source','date','amount','commission','total_doc','req_num',
    'pnr','passenger_name','airline_code','route','status','currency','closed','serial'
  ] loop
    old_v := to_jsonb(old) ->> col;
    new_v := to_jsonb(new) ->> col;
    if old_v is distinct from new_v then
      changed  := changed  || jsonb_build_object(col, new_v);
      old_vals := old_vals || jsonb_build_object(col, old_v);
    end if;
  end loop;

  if changed = '{}'::jsonb then
    return new;   -- nothing a human cares about changed
  end if;

  insert into audit_log (id, user_id, actor_id, actor_email, action, entity_type, entity, detail, before_data, after_data)
  values (
    'aud_' || replace(gen_random_uuid()::text, '-', ''),
    coalesce(new.user_id, actor), actor, coalesce(actor_mail, 'system'),
    'EDIT_TICKET', 'ticket', new.ticket_no,
    (select string_agg(format('%s: %s -> %s', k, coalesce(old_vals ->> k, '(empty)'), coalesce(changed ->> k, '(empty)')), ', ')
     from jsonb_object_keys(changed) as k),
    old_vals, changed
  );
  return new;
end;
$$;

drop trigger if exists tickets_audit on tickets;
create trigger tickets_audit
  after update or delete on tickets
  for each row execute function log_ticket_change();

-- Same accountability for vendor wallet changes — these move money.
create or replace function log_vendor_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor      uuid := auth.uid();
  actor_mail text;
begin
  select email into actor_mail from app_users where id = actor;

  if tg_op = 'DELETE' then
    insert into audit_log (id, user_id, actor_id, actor_email, action, entity_type, entity, detail, before_data)
    values ('aud_' || replace(gen_random_uuid()::text, '-', ''),
            coalesce(old.user_id, actor), actor, coalesce(actor_mail, 'system'),
            'DELETE_VENDOR', 'vendor', old.vendor_name,
            format('Deleted vendor %s (initial %s)', old.vendor_name, old.initial_balance),
            to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    if old.initial_balance is distinct from new.initial_balance then
      insert into audit_log (id, user_id, actor_id, actor_email, action, entity_type, entity, detail, before_data, after_data)
      values ('aud_' || replace(gen_random_uuid()::text, '-', ''),
              coalesce(new.user_id, actor), actor, coalesce(actor_mail, 'system'),
              'EDIT_VENDOR', 'vendor', new.vendor_name,
              format('Opening balance: %s -> %s', old.initial_balance, new.initial_balance),
              to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    insert into audit_log (id, user_id, actor_id, actor_email, action, entity_type, entity, detail, after_data)
    values ('aud_' || replace(gen_random_uuid()::text, '-', ''),
            coalesce(new.user_id, actor), actor, coalesce(actor_mail, 'system'),
            'ADD_VENDOR', 'vendor', new.vendor_name,
            format('Added vendor %s with opening balance %s', new.vendor_name, new.initial_balance),
            to_jsonb(new));
    return new;
  end if;
end;
$$;

drop trigger if exists vendor_balances_audit on vendor_balances;
create trigger vendor_balances_audit
  after insert or update or delete on vendor_balances
  for each row execute function log_vendor_change();

alter publication supabase_realtime add table audit_log;
