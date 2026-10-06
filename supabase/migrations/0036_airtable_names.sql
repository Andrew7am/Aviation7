-- 0036: the names of the records Airtable tickets link to (airlines, portals,
-- team members, accounts, cities, airports), kept between syncs so a run
-- every two minutes does not read six tables to print one changed row.
alter table airtable_sync_state add column if not exists names jsonb;
