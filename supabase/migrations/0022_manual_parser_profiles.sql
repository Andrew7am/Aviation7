-- 0022 manual_parser_profiles: distinguish profiles a person taught from
-- profiles the AI learned.
--
-- Both live in ai_vendor_profiles (same shape, same reader — ProfileParser
-- runs both). Recording origin lets the Settings screen show which came from
-- where, and lets us tell a profile people should feel free to edit apart
-- from one the AI wrote and re-analysis might overwrite.

set search_path = public;

alter table ai_vendor_profiles
  add column if not exists origin text not null default 'ai'
    check (origin in ('ai', 'manual'));
