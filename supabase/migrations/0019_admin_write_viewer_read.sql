-- 0019 admin writes, everyone else reads
--
-- 0017 opened the workspace up so a second person signing in did not see an
-- empty ledger. It did that with "for all to authenticated using (true) with
-- check (true)", which shares the READ but also hands every signed-in Google
-- account full INSERT, UPDATE and DELETE on the tickets, the wallets, the
-- top-ups and the import history. Eight accounts have signed in; seven of
-- them are members who only need to look.
--
-- The split below keeps the shared read and restricts every write to an admin.
-- The role machinery from 0017 is unchanged and already correct: app_users
-- holds the role, is_admin() reads it as SECURITY DEFINER so it can be used
-- inside a policy without recursing.
--
-- Two things deliberately stay open to any authenticated user:
--   * SELECT — the whole point is a shared view of the ledger.
--   * audit_log INSERT — the ticket triggers write it as the acting user, so
--     closing it would make a member's read fail on any table that audits.
--     Reading the audit log is still admin-only (0017).

set search_path = public;

-- ── tickets ──────────────────────────────────────────────────────────────
drop policy if exists tickets_shared       on tickets;
drop policy if exists tickets_read         on tickets;
drop policy if exists tickets_admin_write  on tickets;

create policy tickets_read on tickets
  for select to authenticated using (true);
create policy tickets_admin_write on tickets
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── vendor_balances ──────────────────────────────────────────────────────
drop policy if exists vendor_balances_shared      on vendor_balances;
drop policy if exists vendor_balances_read        on vendor_balances;
drop policy if exists vendor_balances_admin_write on vendor_balances;

create policy vendor_balances_read on vendor_balances
  for select to authenticated using (true);
create policy vendor_balances_admin_write on vendor_balances
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── balance_topups ───────────────────────────────────────────────────────
drop policy if exists balance_topups_shared      on balance_topups;
drop policy if exists balance_topups_read        on balance_topups;
drop policy if exists balance_topups_admin_write on balance_topups;

create policy balance_topups_read on balance_topups
  for select to authenticated using (true);
create policy balance_topups_admin_write on balance_topups
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── import_history ───────────────────────────────────────────────────────
drop policy if exists import_history_shared      on import_history;
drop policy if exists import_history_read        on import_history;
drop policy if exists import_history_admin_write on import_history;

create policy import_history_read on import_history
  for select to authenticated using (true);
create policy import_history_admin_write on import_history
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── error_log ────────────────────────────────────────────────────────────
drop policy if exists error_log_shared      on error_log;
drop policy if exists error_log_read        on error_log;
drop policy if exists error_log_admin_write on error_log;

create policy error_log_read on error_log
  for select to authenticated using (true);
create policy error_log_admin_write on error_log
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── The admin ────────────────────────────────────────────────────────────
-- Named explicitly rather than "whoever is already admin", so re-running this
-- migration always lands on the same single owner. Everyone else is demoted
-- to member; new signups already default to member via handle_new_user().
update app_users set role = 'member'
 where role = 'admin' and email <> 'accounting3@events-explorers.com';

update app_users set role = 'admin'
 where email = 'accounting3@events-explorers.com';
