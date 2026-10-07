-- 0038 tax_invoices: a final tax invoice is one with a ZATCA QR code.
--
-- The heading proved nothing. Ibtekar's booking system prints "TAX INVOICE |
-- فاتورة ضريبية" across its own printouts (INV264215, INV264288) and those
-- were filed here as tax invoices. They carry no QR code. The e-invoices their
-- ZATCA system issues for the same tickets (1599, 1600) do, and only those can
-- carry the VAT. From here `is_tax_invoice` means: a QR code was read off the
-- document, it names Ibtekar's VAT number, and its total and VAT are the ones
-- printed on the page. `qr` keeps what the code said.
--
-- Their system also issues credit notes the same way ("اشعار دائن", notice 15
-- against invoice 1599). A credit note names no tickets; it is kept so the
-- invoice it reduces can be read net of it.

set search_path = public;

alter table tax_invoices add column if not exists qr jsonb;
alter table tax_invoices add column if not exists kind text not null default 'INVOICE'
  check (kind in ('INVOICE', 'CREDIT_NOTE'));
-- The vendor's serial of the invoice a credit note reduces.
alter table tax_invoices add column if not exists against text;
