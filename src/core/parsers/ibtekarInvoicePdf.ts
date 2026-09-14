/**
 * An Ibtekar tax invoice, read by where the words sit on the page.
 *
 * Their invoice is not a table of lines; it is a table of BLOCKS. One ticket
 * occupies three rows:
 *
 *   44  MANSOUR/GIHAN MOHAMED   CAI/JED/RUH/CAI         065-6906030983  1,500.69
 *       Economy Class           Saudi Arabian Airlines  PNR: 7XH5T2
 *                               01/06/2026              27/05/2026
 *
 * Read as flat text the three rows come back interleaved with whatever page
 * furniture shares their vertical band, and the amount column in particular
 * picks up figures from rows it does not belong to. Read by position, the
 * block holds together: the words are grouped into visual rows by their y, and
 * each row's cells are cut at the column boundaries the invoice's own header
 * declares.
 *
 * The amounts are NET. VAT is charged on the invoice as a whole, and it is not
 * a flat 15% of the total: an international sector is zero-rated, so INV261733
 * bills 41,614.62 net with 6,018.38 of VAT — 14.46%. Reading a line's gross as
 * net x 1.15 therefore invents money on any invoice that carries one, which is
 * why this returns the net and leaves the comparison to be made against the
 * invoice's own printed total rather than line by line.
 */

/** One word, with the position it was drawn at. Origin top-left, PDF points. */
export interface PdfWord {
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface InvoiceLine {
  /** Three digits: the numeric airline code off the front of the document. */
  airline: string;
  /** The ten-digit document serial. */
  ticketNo: string;
  passenger: string;
  sector: string;
  carrier: string;
  pnr: string;
  cabin: string;
  /** Net of VAT, as the invoice prints it. */
  amount: number | null;
  travelDate: string;
  issueDate: string;
}

export interface ParsedInvoice {
  invoice: string;
  invoiceDate: string;
  /** True when the page called itself a TAX INVOICE rather than an INVOICE. */
  taxInvoice: boolean;
  lines: InvoiceLine[];
  subTotal: number | null;
  vat: number | null;
  /** What the invoice asks to be paid — net plus VAT. */
  total: number | null;
}

const RE_TICKET = /^(\d{3})-?(\d{10})$/;
const RE_MONEY = /^-?[\d,]+\.\d\d$/;
const RE_DATE = /^(\d{2})\/(\d{2})\/(20\d{2})$/;
const RE_INV = /\bINV(\d{6})\b/;

const iso = (d: string) => {
  const m = RE_DATE.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const num = (s: string) => Number(s.replace(/,/g, ''));

/** Words that were drawn on the same visual row, left to right. */
export function toRows(words: PdfWord[]): PdfWord[][] {
  const sorted = words.slice().sort((a, b) =>
    a.page - b.page || Math.round(a.y * 10) - Math.round(b.y * 10) || a.x - b.x);
  const rows: PdfWord[][] = [];
  for (const w of sorted) {
    const last = rows[rows.length - 1];
    if (last && last[0].page === w.page && Math.abs(last[0].y - w.y) < 3) last.push(w);
    else rows.push([w]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Where each column starts, taken from the invoice's own header row.
 *
 * Hard-coded x values would read one agency's template and nothing else, and
 * would go wrong silently the first time Ibtekar moved a column. The header
 * names the columns, so the header can place them; the fallbacks are the
 * measurements from the invoices in hand, used only when no header is found.
 */
interface Columns { seq: number; name: number; sector: number; ticket: number; amount: number }

export function findColumns(rows: PdfWord[][]): Columns {
  const fallback: Columns = { seq: 0, name: 45, sector: 200, ticket: 350, amount: 500 };
  for (const r of rows) {
    const at = (t: string) => r.find(w => w.text.toLowerCase() === t)?.x;
    const name = at('name'), sector = at('sector'), ticket = at('ticket'), amount = at('amount');
    if (name === undefined || sector === undefined || ticket === undefined || amount === undefined) continue;
    // Boundaries sit a little left of each heading: the values below a heading
    // are not always flush with it, and an amount is right-aligned under it.
    return {
      seq: 0,
      name: name - 6,
      sector: sector - 6,
      ticket: ticket - 6,
      amount: amount - 40,
    };
  }
  return fallback;
}

const between = (r: PdfWord[], lo: number, hi: number) =>
  r.filter(w => w.x >= lo && w.x < hi).map(w => w.text).join(' ').trim();

const moneyFrom = (r: PdfWord[], lo: number) => {
  for (const w of r) if (w.x >= lo && RE_MONEY.test(w.text)) return num(w.text);
  return null;
};

/**
 * Every invoice in the document.
 *
 * A file may hold one invoice or thirty: Ibtekar sends bundles, and a bundle
 * reissued under the same numbers is how INV263283 came to exist twice, once
 * with two tickets and once with one. Each invoice starts where its number is
 * printed and runs until the next one, so a bundle comes back as a list in the
 * order the pages sit.
 */
export function parseIbtekarInvoicePdf(words: PdfWord[]): ParsedInvoice[] {
  const rows = toRows(words);
  const col = findColumns(rows);
  const out: ParsedInvoice[] = [];
  let cur: ParsedInvoice | null = null;
  let pending: InvoiceLine | null = null;
  // "TAX INVOICE" is the page's title and sits ABOVE the number it titles, so
  // it is read before there is an invoice to attach it to.
  let titled = false;

  for (const r of rows) {
    const text = r.map(w => w.text).join(' ');
    if (text.includes('TAX INVOICE')) titled = true;

    const m = RE_INV.exec(text);
    if (m && (!cur || cur.invoice !== `INV${m[1]}`)) {
      cur = {
        invoice: `INV${m[1]}`, invoiceDate: '', taxInvoice: titled,
        lines: [], subTotal: null, vat: null, total: null,
      };
      out.push(cur);
      pending = null;
      titled = false;
      continue;
    }
    if (!cur) continue;
    if (text.includes('TAX INVOICE')) cur.taxInvoice = true;

    if (!cur.invoiceDate && /Date/.test(text)) {
      const d = r.find(w => RE_DATE.test(w.text));
      if (d) cur.invoiceDate = iso(d.text);
    }

    if (/Sub/.test(text) && /Total/.test(text)) cur.subTotal = moneyFrom(r, col.amount) ?? cur.subTotal;
    else if (/Total/.test(text) && /VAT/.test(text)) cur.vat = moneyFrom(r, col.amount) ?? cur.vat;
    else if (/\bTotal\b/.test(text) && cur.total === null) cur.total = moneyFrom(r, col.amount);

    // The first row of a ticket block: a sequence number in the left margin
    // and the document number in the ticket column.
    const tk = r.find(w => RE_TICKET.test(w.text));
    if (tk && r[0].x < col.name && /^\d+$/.test(r[0].text)) {
      const t = RE_TICKET.exec(tk.text)!;
      pending = {
        airline: t[1], ticketNo: t[2],
        passenger: between(r, col.name, col.sector),
        sector: between(r, col.sector, col.ticket),
        carrier: '', pnr: '', cabin: '',
        amount: moneyFrom(r, col.amount),
        travelDate: '', issueDate: '',
      };
      cur.lines.push(pending);
      continue;
    }
    if (!pending) continue;

    // The second row: cabin on the left, carrier in the sector column, PNR
    // where the document number was.
    if (text.includes('PNR:')) {
      pending.cabin = between(r, col.name, col.sector);
      pending.carrier = between(r, col.sector, col.ticket);
      const p = /PNR:\s*(\S+)/.exec(text);
      if (p) pending.pnr = p[1];
      continue;
    }

    // The third: travel date under the sector, issue date under the document.
    const dates = r.filter(w => RE_DATE.test(w.text));
    if (dates.length) {
      for (const d of dates) {
        if (d.x < col.ticket) pending.travelDate = iso(d.text);
        else pending.issueDate = iso(d.text);
      }
      pending = null;
    }
  }

  return out;
}

/**
 * Does the invoice add up on its own terms?
 *
 * Its lines should come to its printed subtotal, and subtotal plus VAT to its
 * total. When they do not, the reading is wrong — or the document is — and
 * nothing should be concluded from comparing it to the ledger.
 */
export function invoiceFoots(inv: ParsedInvoice): { lines: boolean; totals: boolean; lineSum: number } {
  const lineSum = Math.round(inv.lines.reduce((n, l) => n + (l.amount ?? 0), 0) * 100) / 100;
  return {
    lineSum,
    lines: inv.subTotal !== null && Math.abs(lineSum - inv.subTotal) < 0.02,
    totals: inv.subTotal !== null && inv.vat !== null && inv.total !== null
         && Math.abs(inv.subTotal + inv.vat - inv.total) < 0.02,
  };
}
