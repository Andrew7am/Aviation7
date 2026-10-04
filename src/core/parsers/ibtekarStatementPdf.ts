import type { PdfWord } from './ibtekarInvoicePdf';
import { toRows } from './ibtekarInvoicePdf';

/**
 * An Ibtekar statement of account, read by where the words sit on the page.
 *
 * A statement is not an invoice and must not be read as one. It carries the
 * invoice NUMBERS - one per ticket line, in its Document column - so an
 * invoice reader turned loose on it finds eleven invoice numbers, no ticket
 * blocks under any of them, and reports eleven empty invoices. That is what it
 * did, which is why documentKind() exists and runs first.
 *
 * Its columns do not line up row for row either. Read as flat text the opening
 * balance lands on the first ticket's line, so the running balance appears to
 * be one row ahead of the debit that produced it, and the period looks like it
 * is 783.00 out. By position it reads straight:
 *
 *   Balance B/F                                    13,235.37 Cr
 *   08/08/2026  INV263097  593 - 4861234273  783.00  0.00  12,452.37 Cr
 *
 * The money is grouped into three sections the statement names itself -
 * TICKET, RECEIPT, OTHER - and closes on "Amount Payable To You".
 */

export interface StatementLine {
  /** TICKET, RECEIPT or OTHER, as the statement groups them. */
  section: string;
  date: string;
  /** INV… for a ticket line, RV… for a receipt. */
  document: string;
  airline: string;
  ticketNo: string;
  debit: number;
  credit: number;
  balance: number | null;
}

export interface ParsedStatement {
  periodStart: string;
  periodEnd: string;
  currency: string;
  /** Positive is their "Cr" - credit in our favour. */
  openingBalance: number;
  closingBalance: number;
  /** The sum of the debits: what they billed over the period. */
  billed: number;
  /** The sum of the credits: receipts, and anything else in our favour. */
  paid: number;
  lines: StatementLine[];
  /** opening + paid - billed, which is what the closing balance should be. */
  impliedClosing: number;
  foots: boolean;
}

const RE_MONEY = /^-?[\d,]+\.\d\d$/;
const RE_DMY = /^(\d{2})\/(\d{2})\/(20\d{2})$/;
const RE_TICKET = /^(\d{3})-?(\d{10})$/;

const num = (s: string) => Number(s.replace(/,/g, ''));
const iso = (d: string) => {
  const m = RE_DMY.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Which of Ibtekar's documents this is.
 *
 * Decided from the page's own title rather than from what happens to parse,
 * so a statement is never silently run through the invoice reader and reported
 * as a row of empty invoices.
 */
export function documentKind(words: PdfWord[]): 'statement' | 'invoice' | 'unknown' {
  const text = words.map(w => w.text).join(' ').toUpperCase();
  if (text.includes('STATEMENT OF ACCOUNT')) return 'statement';
  if (/\bINV\d{6}\b/.test(text) && (text.includes('INVOICE') || text.includes('PNR:'))) return 'invoice';
  return 'unknown';
}

interface Cols { doc: number; ticket: number; debit: number; credit: number; balance: number }

/** Column boundaries, from the statement's own header row. */
function findColumns(rows: PdfWord[][]): Cols {
  const fallback: Cols = { doc: 110, ticket: 205, debit: 470, credit: 545, balance: 640 };
  for (const r of rows) {
    const at = (t: string) => r.find(w => w.text.toLowerCase() === t)?.x;
    const doc = at('document'), ticket = at('ticket');
    const debit = at('debit'), credit = at('credit'), balance = at('balance');
    if ([doc, ticket, debit, credit, balance].some(v => v === undefined)) continue;
    // Debits and credits are right-aligned under their headings, so each band
    // opens well left of the word that names it.
    return {
      doc: doc! - 6,
      ticket: ticket! - 6,
      debit: debit! - 40,
      credit: credit! - 25,
      balance: balance! - 20,
    };
  }
  return fallback;
}

const moneyIn = (r: PdfWord[], lo: number, hi: number) => {
  for (const w of r) if (w.x >= lo && w.x < hi && RE_MONEY.test(w.text)) return num(w.text);
  return null;
};

/**
 * The narrower print Ibtekar also issues: "Doc no" for "Document", no TICKET /
 * RECEIPT sections, and every cell too narrow for what it holds, so it wraps
 * onto the line below:
 *
 *   08/08/20  INV263097  593 -       ALY/MOHAMED  ...  783.00  0.00  13,605.37
 *   26                   4861234273  MAKRAM                              Cr
 *
 * and a figure can break in the middle: "14,388.3" over "7 Cr". Read line by
 * line it has no dates, no ticket numbers and no opening balance - which is
 * how a statement came back as its closing figure and nothing else. So each
 * entry is gathered with its continuation lines first, and each column read as
 * the run of everything printed in it.
 */
interface WrappedCols { doc: number; ticket: number; lpo: number; debit: number; credit: number; balance: number; narration: number }

function wrappedColumns(rows: PdfWord[][]): WrappedCols | null {
  for (const r of rows) {
    const at = (t: string) => r.find(w => w.text.toLowerCase() === t)?.x;
    const doc = at('doc'), ticket = at('ticket'), lpo = at('lpo');
    const debit = at('debit'), credit = at('credit'), balance = at('balance'), narration = at('narration');
    if ([doc, ticket, lpo, debit, credit, balance].some(v => v === undefined)) continue;
    if (!r.some(w => w.text.toLowerCase() === 'no')) continue;
    // Figures are right-aligned under headings narrower than they are, so
    // each band opens a little left of the word that names it.
    return {
      doc: doc! - 4, ticket: ticket! - 4, lpo: lpo! - 4,
      debit: debit! - 25, credit: credit! - 10, balance: balance! - 12,
      narration: narration ?? balance! + 38,
    };
  }
  return null;
}

const RE_DMY_SPLIT = /^\d{2}\/\d{2}\/\d{2}(\d{2})?$/;
const RE_MONEY_IN = /-?[\d,]+\.\d\d/;

function parseWrapped(rows: PdfWord[][], col: WrappedCols): ParsedStatement {
  const st: ParsedStatement = {
    periodStart: '', periodEnd: '', currency: 'SAR',
    openingBalance: 0, closingBalance: 0, billed: 0, paid: 0,
    lines: [], impliedClosing: 0, foots: false,
  };

  // An entry opens on a date in the left margin, or on the opening balance;
  // the lines a few points below it, before the next one opens, are its own.
  const opens = (r: PdfWord[]) =>
    r.some(w => w.x < col.doc && RE_DMY_SPLIT.test(w.text)) || /Balance\s+B\/F/.test(r.map(w => w.text).join(' '));
  const entries: PdfWord[][][] = [];
  let cur: PdfWord[][] | null = null;
  for (const r of rows) {
    const text = r.map(w => w.text).join(' ');
    if (/Period/.test(text)) {
      const m = /(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/.exec(text);
      if (m) { st.periodStart = iso(m[1]); st.periodEnd = iso(m[2]); }
    }
    if (/Currency/.test(text)) {
      const m = /\b(SAR|AED|USD|EUR)\b/.exec(text);
      if (m) st.currency = m[1];
    }
    if (/Amount\s+Payable\s+To\s+You/.test(text)) {
      const m = /:\s*([\d,]+\.\d\d)\s*(Cr|Dr)/.exec(text);
      if (m) st.closingBalance = m[2] === 'Cr' ? num(m[1]) : -num(m[1]);
      cur = null; continue;
    }
    if (/^Total\b/.test(text.trim()) || /\bPage\s+\d+\/\d+/.test(text)) { cur = null; continue; }
    if (opens(r)) { cur = [r]; entries.push(cur); continue; }
    const last = cur?.[cur.length - 1];
    if (cur && last && last[0].page === r[0].page && r[0].y - last[0].y <= 13) cur.push(r);
    else cur = null;
  }

  // Everything printed in one column of an entry, top to bottom, run together.
  const band = (e: PdfWord[][], lo: number, hi: number) =>
    e.map(r => r.filter(w => w.x >= lo && w.x < hi).map(w => w.text).join('')).join('');
  const money = (s: string) => { const m = RE_MONEY_IN.exec(s); return m ? num(m[0]) : null; };

  for (const e of entries) {
    const text = e.map(r => r.map(w => w.text).join(' ')).join(' ');
    if (/Balance\s+B\/F/.test(text)) {
      const fig = band(e, col.debit, col.narration);
      const v = money(fig) ?? 0;
      st.openingBalance = /Dr/.test(fig) ? -v : v;
      continue;
    }
    const date = band(e, 0, col.doc);
    const doc = band(e, col.doc, col.ticket);
    const tk = band(e, col.ticket, col.lpo);
    const m = RE_TICKET.exec(tk);
    const bal = band(e, col.balance, col.narration);
    st.lines.push({
      section: /^INV/i.test(doc) ? 'TICKET' : /^RV/i.test(doc) ? 'RECEIPT' : 'OTHER',
      date: iso(date),
      document: doc,
      airline: m ? m[1] : '',
      ticketNo: m ? m[2] : tk,
      debit: money(band(e, col.debit, col.credit)) ?? 0,
      credit: money(band(e, col.credit, col.balance)) ?? 0,
      balance: money(bal) == null ? null : (/Dr/.test(bal) ? -money(bal)! : money(bal)),
    });
  }

  st.billed = round2(st.lines.reduce((n, l) => n + l.debit, 0));
  st.paid = round2(st.lines.reduce((n, l) => n + l.credit, 0));
  st.impliedClosing = round2(st.openingBalance + st.paid - st.billed);
  st.foots = Math.abs(st.impliedClosing - st.closingBalance) < 0.011;
  return st;
}

export function parseIbtekarStatementPdf(words: PdfWord[]): ParsedStatement | null {
  const rows = toRows(words);
  if (!rows.length) return null;
  const wrapped = wrappedColumns(rows);
  if (wrapped) {
    const st = parseWrapped(rows, wrapped);
    return st.lines.length || st.openingBalance ? st : null;
  }
  const col = findColumns(rows);

  const st: ParsedStatement = {
    periodStart: '', periodEnd: '', currency: 'SAR',
    openingBalance: 0, closingBalance: 0, billed: 0, paid: 0,
    lines: [], impliedClosing: 0, foots: false,
  };
  let section = '';
  let sawOpening = false;

  for (const r of rows) {
    const text = r.map(w => w.text).join(' ');

    if (/Period/.test(text)) {
      const m = /(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/.exec(text);
      if (m) { st.periodStart = iso(m[1]); st.periodEnd = iso(m[2]); }
    }
    if (/Currency/.test(text)) {
      const m = /\b(SAR|AED|USD|EUR)\b/.exec(text);
      if (m) st.currency = m[1];
    }

    if (/Balance\s+B\/F/.test(text)) {
      const v = moneyIn(r, col.debit, 1e4) ?? 0;
      // "Cr" on the line means the balance is in our favour.
      st.openingBalance = /\bCr\b/.test(text) ? v : -v;
      sawOpening = true;
      continue;
    }

    if (/Amount\s+Payable\s+To\s+You/.test(text)) {
      const m = /:\s*([\d,]+\.\d\d)\s*(Cr|Dr)/.exec(text);
      if (m) st.closingBalance = m[2] === 'Cr' ? num(m[1]) : -num(m[1]);
      continue;
    }

    const bare = text.trim();
    if (/^(INVOICE|TICKET|OTHER|RECEIPT)$/.test(bare)) { section = bare; continue; }
    if (/^(TICKET|INVOICE|RECEIPT|OTHER)\s+Total\b/.test(bare) || /^Total\b/.test(bare)) continue;

    // A movement: a date in the left margin, then a document and a figure.
    const first = r[0];
    if (!first || first.x >= col.doc || !RE_DMY.test(first.text)) continue;

    const docWord = r.find(w => w.x >= col.doc && w.x < col.ticket);
    const tkText = r.filter(w => w.x >= col.ticket && w.x < col.debit).map(w => w.text).join('');
    const m = RE_TICKET.exec(tkText);

    st.lines.push({
      section,
      date: iso(first.text),
      document: docWord?.text ?? '',
      airline: m ? m[1] : '',
      ticketNo: m ? m[2] : tkText,
      debit: moneyIn(r, col.debit, col.credit) ?? 0,
      credit: moneyIn(r, col.credit, col.balance) ?? 0,
      balance: moneyIn(r, col.balance, 1e4),
    });
  }

  if (!sawOpening && !st.lines.length) return null;

  st.billed = round2(st.lines.reduce((n, l) => n + l.debit, 0));
  st.paid = round2(st.lines.reduce((n, l) => n + l.credit, 0));
  st.impliedClosing = round2(st.openingBalance + st.paid - st.billed);
  st.foots = Math.abs(st.impliedClosing - st.closingBalance) < 0.011;
  return st;
}
