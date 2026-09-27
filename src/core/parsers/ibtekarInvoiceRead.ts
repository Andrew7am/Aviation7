import type { PdfWord, ParsedInvoice } from './ibtekarInvoicePdf';
import { parseIbtekarInvoicePdf } from './ibtekarInvoicePdf';
import { parseIbtekarZatcaPdf, zatcaSerial, isZatcaInvoice } from './ibtekarZatcaPdf';
import { documentKind } from './ibtekarStatementPdf';

/**
 * One way in for an Ibtekar invoice, whichever template it was drawn on.
 *
 * Ibtekar send two, and the failure that matters is the quiet one. The older
 * reader hands back an empty list when it is given the ZATCA template — no
 * error, nothing to see — and a tracker built on that would answer "no tax
 * invoice" for every ticket on every new invoice, which is the same wrong
 * answer as not having uploaded it at all. Invoice 1559 was once reported
 * missing for exactly this reason while sitting on the shared drive.
 *
 * So a document that cannot be read says so. `problems` is not advisory: the
 * tracker refuses to record a file that produced nothing, because recording
 * nothing is indistinguishable from recording an absence.
 */

export type InvoiceLayout = 'CLASSIC' | 'ZATCA';

export interface ReadInvoice {
  invoice: ParsedInvoice;
  layout: InvoiceLayout;
  /** Ibtekar's own short serial, where the template prints one. */
  theirSerial: string;
}

export interface ReadResult {
  invoices: ReadInvoice[];
  /** Human-readable reasons the file gave up less than it should have. */
  problems: string[];
}

export function readIbtekarInvoices(words: PdfWord[], fileName = ''): ReadResult {
  const problems: string[] = [];

  if (!words.length) return { invoices: [], problems: ['the file has no readable text — a scan, not a PDF of text'] };

  if (documentKind(words) === 'statement')
    return { invoices: [], problems: ['this is a statement of account, not an invoice'] };

  if (isZatcaInvoice(words)) {
    const inv = parseIbtekarZatcaPdf(words, fileName);
    if (!inv) return { invoices: [], problems: ['recognised as a ZATCA invoice but nothing could be read from it'] };
    if (!inv.invoice)
      problems.push('the document carries no invoice number and the file name has no INV number either');
    if (!inv.lines.length) problems.push('no ticket numbers are printed on it');
    if (!inv.taxInvoice) problems.push('it does not call itself a tax invoice');
    return {
      invoices: inv.invoice ? [{ invoice: inv, layout: 'ZATCA', theirSerial: zatcaSerial(words) }] : [],
      problems,
    };
  }

  const parsed = parseIbtekarInvoicePdf(words);
  if (!parsed.length)
    return { invoices: [], problems: ['no invoice could be read — neither template matched'] };

  const good = parsed.filter(i => i.lines.length > 0);
  for (const i of parsed.filter(i => !i.lines.length))
    problems.push(`${i.invoice}: an invoice number with no ticket lines beneath it`);
  for (const i of good) if (!i.taxInvoice)
    problems.push(`${i.invoice}: does not call itself a tax invoice`);

  return {
    invoices: good.map(invoice => ({ invoice, layout: 'CLASSIC' as const, theirSerial: '' })),
    problems,
  };
}
