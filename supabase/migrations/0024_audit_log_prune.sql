-- 0024 let an admin prune the audit log
--
-- The audit log has never had a DELETE policy. With RLS on, that means no
-- delete has ever been possible from the client - not for a member, and not
-- for an admin either. The table only grows.
--
-- This opens deletion to admins alone, and it is worth being clear-eyed about
-- what that costs. The audit log is the record of who changed what: it is the
-- one table whose value comes from nobody being able to edit it. An admin who
-- can clear it can also cover a mistake, and the log will not say so.
--
-- Two things narrow that as far as it can be narrowed while still doing what
-- was asked:
--
--   * is_admin() gates it, exactly as every other write is gated. A member
--     cannot delete a row, and the read policy already stops them seeing one.
--
--   * A cutoff is required. The policy refuses to delete anything from the
--     last seven days, so a change made this week cannot be erased in the
--     same week it was made - which is when covering one would matter most.
--     Pruning old noise stays available; erasing what just happened does not.
--
-- Note what this is NOT for. The Activity Log screen reads 500 rows through
-- an index in a quarter of a millisecond; the table's size has never been a
-- performance problem and deleting from it will not make anything faster.
-- This exists for housekeeping, and the screen says so.

set search_path = public;

drop policy if exists audit_log_admin_prune on audit_log;

create policy audit_log_admin_prune on audit_log
  for delete to authenticated
  using (
    is_admin()
    and performed_at < now() - interval '7 days'
  );
