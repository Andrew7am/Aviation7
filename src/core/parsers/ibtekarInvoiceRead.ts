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
  for (const i of good) {
    if (!i.taxInvoice) problems.push(`${i.invoice}: does not call itself a tax invoice`);
    problems.push(...dropUntrustedTotals(i));
  }

  return {
    invoices: good.map(invoice => ({ invoice, layout: 'CLASSIC' as const, theirSerial: '' })),
    problems,
  };
}

/**
 * A subtotal and a VAT figure that do not make the total are not this
 * invoice's.
 *
 * Ibtekar send bundles — thirty invoices in one file — and in a bundle the
 * totals block of one invoice can be picked up by the next one along.
 * INV261827 came back with a subtotal of 733.62 against a printed total of
 * 12,645.00, and INV262113 with 1,417.89 against 2,023.00. In both, the lines
 * and the total agree with each other exactly; it is the two rows between
 * them that came from somewhere else.
 *
 * Storing them anyway would put a net and a VAT in the tracker belonging to a
 * different document, and the VAT is the one figure this whole exercise
 * exists to get right. So they are dropped and the reading says so. The total
 * is kept: it is what the invoice's own lines come to.
 */
function dropUntrustedTotals(inv: ParsedInvoice): string[] {
  const { subTotal, vat, total } = inv;
  if (subTotal === null || vat === null || total === null) return [];
  if (Math.abs(subTotal + vat - total) < 0.02) return [];
  inv.subTotal = null;
  inv.vat = null;
  return [`${inv.invoice}: its net and VAT rows do not make its total `
        + `(${subTotal.toFixed(2)} + ${vat.toFixed(2)} is not ${total.toFixed(2)}), so they `
        + `were read off a neighbouring invoice in the bundle. They are not kept; its total is.`];
}

/**
 * Of two readings of the SAME invoice number, the one to keep.
 *
 * The same invoice arrives more than once: inside a bundle and again on its
 * own, or on both templates. INV263549 reads out of a bundle with no totals
 * and no TAX INVOICE heading, and again from its own ZATCA file, complete.
 * Keeping whichever was read first makes the answer depend on the order
 * somebody dropped the files in, which is not a rule.
 *
 * A document that calls itself a tax invoice beats one that does not, because
 * that is the only thing here deciding whether the VAT can be reclaimed.
 * After that, a reading with a total beats one without, and one naming more
 * tickets beats one naming fewer.
 */
export function preferReading(a: ReadInvoice, b: ReadInvoice): ReadInvoice {
  const score = (r: ReadInvoice) => [
    r.invoice.taxInvoice ? 1 : 0,
    r.invoice.total !== null ? 1 : 0,
    r.invoice.lines.length,
    r.invoice.subTotal !== null && r.invoice.vat !== null ? 1 : 0,
  ];
  const [x, y] = [score(a), score(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
  return a;
}
