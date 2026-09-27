-- 0026 tax_invoices: the tax invoices we actually hold, and the documents
-- printed on them.
--
-- WHY THIS IS NOT THE INVOICE NUMBER ALREADY IN THE LEDGER
--
-- Every Ibtekar row in `tickets` carries a vendor_reference, and it looks
-- like the answer. It is not. That reference was typed off a statement of
-- account, and a statement is not a tax invoice: it summarises a period and
-- lists document numbers. You cannot reclaim VAT with it, and you cannot put
-- it in front of an auditor. On Ibtekar's newer ZATCA template the reference
-- is not even printed on the invoice — it survives only in the file name.
--
-- So "it has an invoice number" and "we hold the invoice" are two different
-- facts, and this table records the second one. A row here exists because a
-- document was read, and the serials on `tax_invoice_lines` are the ticket
-- numbers that document actually prints.
--
-- WHY NO ticket_id ON THE LINES
--
-- An invoice is read once and the ledger keeps moving: the ticket an invoice
-- bills may be imported a week later. Resolving the link at read time means a
-- ticket that arrives afterwards lights up on its own; a stored ticket_id
-- would freeze the answer at whatever the ledger happened to hold that day,
-- and nothing would ever correct it. The serial is what the paper says, and
-- the paper does not change.
--
-- WHY THE FILE ITSELF IS NOT HERE
--
-- The PDFs live on the shared drive and stay there. This records what the
-- document says, not the document.

set search_path = public;

create table if not exists tax_invoices (
  id               text primary key,
  user_id          uuid not null,
  vendor           text not null,

  -- The number this invoice is filed under: our INV###### where the document
  -- or its file name gives one, otherwise the vendor's own serial. Never
  -- blank — an invoice with no identity cannot be tracked and would silently
  -- merge with the next one uploaded.
  invoice_no       text not null,
  -- The vendor's own short serial, where their template prints one beside
  -- (or instead of) our reference.
  their_serial     text,
  invoice_date     date,

  -- The whole point of the exercise. A document that does not call itself a
  -- tax invoice cannot be used to reclaim the VAT on it, so it is recorded
  -- and counted separately rather than quietly treated as one.
  is_tax_invoice   boolean not null default false,

  currency         text not null default 'SAR',
  net              numeric(14,2),
  vat              numeric(14,2),
  total            numeric(14,2),

  -- CLASSIC (per-ticket amounts) or ZATCA (one aggregated line). On ZATCA
  -- there is nothing to compare line by line; only the total is comparable,
  -- and the screen has to say so rather than show empty amounts.
  layout           text,
  source_file      text,
  note             text,

  created_at       timestamptz not null default now(),

  constraint tax_invoices_identity unique (vendor, invoice_no)
);

create table if not exists tax_invoice_lines (
  id               text primary key,
  invoice_id       text not null references tax_invoices(id) on delete cascade,

  airline_code     text,
  -- Ten digits, as the document prints them.
  ticket_serial    text not null,
  passenger        text,
  sector           text,
  pnr              text,
  -- Net of VAT, as the invoice prints it. Null on ZATCA, where the template
  -- carries no per-ticket figure at all: null means "the document does not
  -- say", and is not the same as zero.
  amount           numeric(14,2),
  travel_date      date,
  issue_date       date,

  constraint tax_invoice_lines_once unique (invoice_id, ticket_serial)
);

create index if not exists tax_invoice_lines_serial_idx
  on tax_invoice_lines (ticket_serial);
create index if not exists tax_invoices_vendor_idx
  on tax_invoices (vendor, invoice_date desc);

alter table tax_invoices      enable row level security;
alter table tax_invoice_lines enable row level security;

-- Same split as every other table since 0019: the workspace reads, admins
-- write.
drop policy if exists tax_invoices_read        on tax_invoices;
drop policy if exists tax_invoices_admin_write on tax_invoices;
drop policy if exists tax_invoice_lines_read        on tax_invoice_lines;
drop policy if exists tax_invoice_lines_admin_write on tax_invoice_lines;

create policy tax_invoices_read on tax_invoices
  for select to authenticated using (true);
create policy tax_invoices_admin_write on tax_invoices
  for all to authenticated using (is_admin()) with check (is_admin());

create policy tax_invoice_lines_read on tax_invoice_lines
  for select to authenticated using (true);
create policy tax_invoice_lines_admin_write on tax_invoice_lines
  for all to authenticated using (is_admin()) with check (is_admin());
