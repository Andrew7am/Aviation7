-- 0039 airtable_tickets.account / department: whose ticket it is.
--
-- Their sheet names the company each MICE ticket is issued for - Nestle,
-- Allergen, Abbott, Alfasigma, STADA - in "MICE Account (from Aviation
-- Requests) (from Aviation Quotations)", and the department in
-- "Department". VIP and Corporate tickets name no company: the traveller
-- is the client, and the department is what they are grouped under.
--
-- Kept as columns so the Companies screen reads them without pulling every
-- row's whole sheet_row across.

set search_path = public;

alter table airtable_tickets add column if not exists account    text not null default '';
alter table airtable_tickets add column if not exists department text not null default '';

update airtable_tickets set
  account    = coalesce(trim(sheet_row->>'MICE Account (from Aviation Requests) (from Aviation Quotations)'), ''),
  department = coalesce(trim(sheet_row->>'Department'), '')
where account = '' and department = '';

create index if not exists airtable_tickets_account_idx on airtable_tickets (account);
