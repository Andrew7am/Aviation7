import type { PdfWord, ParsedInvoice } from './ibtekarInvoicePdf';
import { parseIbtekarInvoicePdf } from './ibtekarInvoicePdf';
import {
  parseIbtekarZatcaPdf, zatcaSerial, isZatcaInvoice, isZatcaCreditNote, parseIbtekarZatcaCreditNote,
} from './ibtekarZatcaPdf';
import { decodeZatcaQr, IBTEKAR_VAT, type ZatcaQr } from './zatcaQr';
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
  /** The ZATCA QR code that makes it final, when it has one that checks out. */
  qr?: ZatcaQr | null;
  kind?: 'INVOICE' | 'CREDIT_NOTE';
  /** A credit note's: their serial of the invoice it reduces. */
  against?: string;
}

export interface ReadResult {
  invoices: ReadInvoice[];
  /** Human-readable reasons the file gave up less than it should have. */
  problems: string[];
  /**
   * The documents in it that are NOT final tax invoices, and why. Kept apart
   * from the other problems because it is the one somebody has to act on:
   * go back to Ibtekar for the e-invoice.
   */
  notFinal: string[];
}

export const NO_QR = 'no ZATCA QR code on it, so it is not a final tax invoice';

/**
 * Whether a reading is a final tax invoice: a ZATCA QR code is printed on it,
 * the code names Ibtekar as the seller, and its total and VAT are the ones on
 * the page. Sets `taxInvoice` to that answer and returns why not, if not.
 *
 * The heading is no evidence. Ibtekar's booking system heads its own
 * printouts TAX INVOICE (INV264215, INV264288); they carry no QR code and were
 * never through ZATCA. The final invoice for the same tickets comes later from
 * their e-invoicing system under its own short number — INV264215 came back
 * as 1599, INV264288 as 1600.
 *
 * A total or VAT the page did not give up is taken from the code — the code
 * is the document's own signed statement of it.
 */
function settleFinal(r: ReadInvoice, qrs: ZatcaQr[], onlyOne: boolean): string | null {
  const inv = r.invoice;
  const close = (a: number | null, b: number | null) =>
    a === null || b === null || Math.abs(a - b) < 0.015;
  const qr = qrs.find(q => inv.total !== null && q.total !== null && Math.abs(q.total - inv.total) < 0.015)
          ?? (onlyOne && qrs.length === 1 ? qrs[0] : null);
  inv.taxInvoice = false;
  r.qr = null;
  if (!qr) return NO_QR;
  if (qr.vatNo !== IBTEKAR_VAT)
    return `its QR code names VAT number ${qr.vatNo} as the seller, not Ibtekar's ${IBTEKAR_VAT}`;
  if (!close(qr.total, inv.total))
    return `its QR code says ${qr.total?.toFixed(2)} but the page prints ${inv.total?.toFixed(2)}`;
  if (!close(qr.vat, inv.vat))
    return `its QR code says VAT ${qr.vat?.toFixed(2)} but the page prints ${inv.vat?.toFixed(2)}`;
  if (inv.total === null) inv.total = qr.total;
  if (inv.vat === null && qr.vat !== null) {
    inv.vat = qr.vat;
    if (inv.total !== null) inv.subTotal = Math.round((inv.total - qr.vat) * 100) / 100;
  }
  inv.taxInvoice = true;
  r.qr = qr;
  return null;
}

export function readIbtekarInvoices(words: PdfWord[], fileName: string, qrCodes: string[]): ReadResult {
  const problems: string[] = [];
  const notFinal: string[] = [];
  const qrs = qrCodes.map(decodeZatcaQr).filter((q): q is ZatcaQr => q !== null);

  if (!words.length)
    return { invoices: [], problems: ['the file has no readable text — a scan, not a PDF of text'], notFinal };

  if (documentKind(words) === 'statement')
    return { invoices: [], problems: ['this is a statement of account, not an invoice'], notFinal };

  if (isZatcaCreditNote(words)) {
    const cn = parseIbtekarZatcaCreditNote(words);
    if (!cn || !cn.notice)
      return { invoices: [], problems: ['recognised as a credit note but its number could not be read'], notFinal };
    /* Kept as negative figures: it takes money off the invoice it names. No
       tickets are printed on it, so it covers none and uncovers none. */
    const r: ReadInvoice = {
      layout: 'ZATCA', theirSerial: cn.notice, kind: 'CREDIT_NOTE', against: cn.against,
      invoice: {
        invoice: `IBK-CN-${cn.notice}`, invoiceDate: cn.date, taxInvoice: false, lines: [],
        subTotal: cn.net, vat: cn.vat, total: cn.total,
      },
    };
    const why = settleFinal(r, qrs, true);
    if (why) notFinal.push(`credit note ${cn.notice}: ${why}`);
    const neg = (n: number | null) => (n === null ? null : -Math.abs(n));
    Object.assign(r.invoice, {
      subTotal: neg(r.invoice.subTotal), vat: neg(r.invoice.vat), total: neg(r.invoice.total),
    });
    if (!cn.against) problems.push('the credit note does not say which invoice it reduces');
    return { invoices: [r], problems, notFinal };
  }

  if (isZatcaInvoice(words)) {
    const inv = parseIbtekarZatcaPdf(words, fileName);
    if (!inv)
      return { invoices: [], problems: ['recognised as a ZATCA invoice but nothing could be read from it'], notFinal };
    if (!inv.invoice)
      problems.push('the document carries no invoice number and the file name has no INV number either');
    if (!inv.lines.length) problems.push('no ticket numbers are printed on it');
    const r: ReadInvoice = { invoice: inv, layout: 'ZATCA', theirSerial: zatcaSerial(words), kind: 'INVOICE' };
    const why = settleFinal(r, qrs, true);
    if (why) notFinal.push(`${inv.invoice || 'this invoice'}: ${why}`);
    return { invoices: inv.invoice ? [r] : [], problems, notFinal };
  }

  const parsed = parseIbtekarInvoicePdf(words);
  if (!parsed.length)
    return { invoices: [], problems: ['no invoice could be read — neither template matched'], notFinal };

  const good = parsed.filter(i => i.lines.length > 0);
  for (const i of parsed.filter(i => !i.lines.length))
    problems.push(`${i.invoice}: an invoice number with no ticket lines beneath it`);
  for (const i of good) problems.push(...dropUntrustedTotals(i));

  const invoices: ReadInvoice[] = good.map(invoice => ({
    invoice, layout: 'CLASSIC' as const, theirSerial: '', kind: 'INVOICE' as const,
  }));
  for (const r of invoices) {
    const why = settleFinal(r, qrs, invoices.length === 1);
    if (why) notFinal.push(`${r.invoice.invoice}: ${why}`);
  }
  return { invoices, problems, notFinal };
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
