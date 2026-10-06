-- 0037: run the Airtable sync every two minutes from the database.
--
-- pg_cron wakes the job; pg_net makes the HTTP call to the Vercel function.
-- The job itself - which carries the sync secret - is created by
-- scripts/schedule-airtable-sync.ts from the environment, so the secret is
-- in the database's job table and nowhere in the repository.
create extension if not exists pg_cron;
create extension if not exists pg_net;
