import type { PdfWord, ParsedInvoice, InvoiceLine } from './ibtekarInvoicePdf';
import { toRows } from './ibtekarInvoicePdf';

/**
 * Ibtekar's ZATCA tax invoice — the newer bilingual template.
 *
 * It is a different document from the one parseIbtekarInvoicePdf() reads, and
 * three differences decide how it has to be read:
 *
 *   1. There are no per-ticket amounts. The tickets are listed — serial,
 *      date, passenger, sector — and the money appears once, aggregated into
 *      a single line. So there is nothing to compare line by line on these;
 *      the only comparison the document supports is its total.
 *   2. The INV###### reference the ledger files under appears nowhere inside
 *      the page. The document's own number is a short serial printed as
 *      "InvoNO: 1581", and our reference survives only in the file name.
 *   3. Every figure is printed BEFORE its label rather than after it, so a
 *      total is found by locating the label and stepping backwards.
 *
 * The ticket date is optional. The earlier ZATCA invoices list a ticket as
 * number, passenger, sector with no date column at all; the later ones put a
 * date after the number. Requiring one reads every older invoice as empty —
 * which is how invoice 1559 came to be reported missing when it had been on
 * the shared drive the whole time.
 */

const RE_MONEY_ONLY = /^-?[\d,]+\.\d\d$/;
const RE_TICKET = /(\d{3})\s*-\s*(\d{10})/g;
const RE_ISO = /^(20\d{2})-(\d{2})-(\d{2})$/;
const RE_DMY = /\b(\d{2})-(\d{2})-(20\d{2})\b/;

const num = (s: string) => Number(s.replace(/,/g, ''));

/** The labels, as the template prints them — misspelling and all. */
const LABELS = {
  net: ['Total(ExculdingVAT)', 'Total (Excluding VAT)', 'Total(ExcludingVAT)'],
  vat: ['Total VAT', 'TotalVAT'],
  total: ['TotalAmountDue', 'Total Amount Due'],
  paid: ['Total Amount Paid', 'TotalAmountPaid'],
};

/** Words in reading order, squashed to a single comparable string per word. */
function flatten(words: PdfWord[]): string[] {
  return toRows(words).flatMap(r => r.map(w => w.text.trim())).filter(Boolean);
}

/**
 * The money printed immediately before `label`.
 *
 * The label itself may be split across several drawn words ("Total", "VAT"),
 * so it is matched against the run of words joined without spaces, and the
 * search walks back from there to the nearest figure.
 */
function moneyBefore(flat: string[], variants: string[]): number | null {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = variants.map(squash);
  for (let i = 0; i < flat.length; i++) {
    // Try to match the label starting at i, consuming up to four words.
    let joined = '';
    for (let n = 0; n < 4 && i + n < flat.length; n++) {
      joined += squash(flat[i + n]);
      if (!wanted.includes(joined)) continue;
      for (let b = i - 1; b >= 0 && b >= i - 4; b--)
        if (RE_MONEY_ONLY.test(flat[b])) return num(flat[b]);
      return null;
    }
  }
  return null;
}

/** Is this the ZATCA template rather than the older invoice? */
export function isZatcaInvoice(words: PdfWord[]): boolean {
  const flat = flatten(words).join(' ');
  const squashed = flat.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /InvoNO/i.test(flat)
    || squashed.includes('totalamountdue')
    || squashed.includes('totalexculdingvat');
}

/**
 * The invoice, or null when the page is not one of these.
 *
 * `fileName` is not decoration: on this template our own INV###### reference
 * exists nowhere but the file name, and a tracker keyed on the document's own
 * short serial alone could not be tied back to anything the ledger holds.
 */
export function parseIbtekarZatcaPdf(
  words: PdfWord[], fileName = '',
): ParsedInvoice | null {
  if (!words.length || !isZatcaInvoice(words)) return null;

  const flat = flatten(words);
  const text = flat.join(' ');

  const lines: InvoiceLine[] = [];
  const seen = new Set<string>();
  for (const hit of text.matchAll(RE_TICKET)) {
    const ticketNo = hit[2];
    if (seen.has(ticketNo)) continue;
    seen.add(ticketNo);
    // The date, when the template carries one, is the next word after the
    // number. There are no per-ticket amounts on this layout at all, and a
    // guessed one would be worse than none: it would make a line-by-line
    // comparison look available when the document does not support one.
    const at = flat.findIndex(w => w.replace(/\s/g, '').includes(`-${ticketNo}`)
                                || w === ticketNo);
    const next = at >= 0 ? (flat[at + 1] ?? '') : '';
    lines.push({
      airline: hit[1], ticketNo,
      passenger: '', sector: '', carrier: '', pnr: '', cabin: '',
      amount: null,
      travelDate: '',
      issueDate: RE_ISO.test(next) ? next : '',
    });
  }

  const dmy = RE_DMY.exec(text);
  const serial = /InvoNO:?\s*(\d+)/i.exec(text)?.[1] ?? '';
  const ref = (fileName.match(/INV\d{6}/i)?.[0] ?? '').toUpperCase();

  return {
    // The number the tracker files it under: our reference when the file name
    // gives one, otherwise Ibtekar's own serial. Never blank — an invoice with
    // no identity cannot be tracked, and would silently merge with the next.
    invoice: ref || (serial ? `IBK-${serial}` : ''),
    invoiceDate: dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : '',
    taxInvoice: /Tax\s*Invoice/i.test(text),
    lines,
    subTotal: moneyBefore(flat, LABELS.net),
    vat: moneyBefore(flat, LABELS.vat),
    total: moneyBefore(flat, LABELS.total),
  };
}

/** Ibtekar's own short serial, for showing beside our reference. */
export function zatcaSerial(words: PdfWord[]): string {
  return /InvoNO:?\s*(\d+)/i.exec(flatten(words).join(' '))?.[1] ?? '';
}
