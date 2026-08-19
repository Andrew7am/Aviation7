/**
 * IATA BSP reconciliation: matching the ledger against the settlement invoices.
 *
 * Two operations sit on top of this, and both are IATA-only by construction —
 * nothing here ever sees a row from another vendor, because the caller selects
 * on `source = 'IATA BSP'` before handing rows over:
 *
 *   1. DATE CORRECTION — existing rows carry the file upload date; the invoice
 *      carries the real transaction date.
 *   2. MISSING IMPORT — transactions the invoice bills that the ledger never
 *      received (manual refunds, EMDs, SPDR, memos, the WEBSALES-EDIS channel).
 *
 * The module deliberately returns buckets rather than performing writes, so the
 * preview and the apply run off exactly the same decisions.
 */

export interface InvoiceTxn {
  ticketNo: string;
  rawType: string;        // TKTT, RFND, EMDS, SPDR, ADMA, CANX, ...
  status: string;         // ISSUE | REFUND | VOID | EMDS | ADM | ACM
  date: string;           // yyyy-mm-dd, straight off the invoice
  channel: string;        // BSP | WEBSALES-EDIS
  fare: number;           // Transaction Amount, signed
  commission: number;     // total commission, signed
  payable: number;        // Balance Payable, signed — the ledger figure
  currency: string;
  airlineCode?: string;
  vendorReference?: string;
  file?: string;
}

export interface LedgerTxn {
  id: string;
  ticketNo: string;
  status?: string;
  date: string;
  amount: number;
  totalDoc: number;
}

export interface Reconciliation {
  /** Existing rows whose date must be replaced by the invoice date. */
  dateUpdates: { row: LedgerTxn; invoice: InvoiceTxn }[];
  /** Existing rows already holding the invoice date — no write. */
  alreadyCorrect: { row: LedgerTxn; invoice: InvoiceTxn }[];
  /** Rows sharing a key where the money singles out no invoice line. */
  unresolved: LedgerTxn[];
  /** Existing rows the invoices never mention. Kept, never touched. */
  ledgerNoInvoice: LedgerTxn[];
  /** Invoice lines with no ledger row at all. */
  missing: InvoiceTxn[];
  /** Missing lines that are VOID — excluded from import by business rule. */
  excludedVoid: InvoiceTxn[];
  /** Missing lines that must be inserted. */
  toImport: InvoiceTxn[];
}

/** Document numbers compare on digits with leading zeros stripped; the original
 *  is always what gets stored. */
export const normDoc = (d: string): string =>
  (d || '').replace(/[^0-9]/g, '').replace(/^0+/, '');

const REFUNDY = new Set(['RFND', 'RFNC']);

/** Direction is part of the key so a refund never matches the sale of the same
 *  document — they are two legitimate transactions, not duplicates. */
export const dirOf = (rawType: string, payable: number): '+' | '-' =>
  REFUNDY.has((rawType || '').toUpperCase()) || payable < 0 ? '-' : '+';

export const invoiceKey = (t: InvoiceTxn): string =>
  `${normDoc(t.ticketNo)}|${dirOf(t.rawType, t.payable)}`;

/** The ledger has no document-type column, so direction comes from the money. */
export const ledgerKey = (t: LedgerTxn): string =>
  `${normDoc(t.ticketNo)}|${t.amount < 0 ? '-' : '+'}`;

export const isVoid = (t: { status?: string }): boolean =>
  (t.status || '').toUpperCase() === 'VOID';

/** Compared on magnitude: the ledger and the invoice can differ on sign
 *  convention, never on how much. */
const near = (a: number, b: number): boolean =>
  Math.abs(Math.abs(a) - Math.abs(b)) < 0.011;

/** Where a document was re-billed across periods, the EARLIEST date is the
 *  transaction date; later appearances must not overwrite it. */
const earliest = (rows: InvoiceTxn[]): InvoiceTxn =>
  rows.reduce((a, b) => (a.date <= b.date ? a : b));

/**
 * Pick the invoice line belonging to one ledger row when several rows share a
 * document+direction key — a void beside its sale, a second partial refund, a
 * zero-value stub. Resolves on money: Transaction Amount against the ledger
 * fare, falling back to Balance Payable against the ledger amount.
 *
 * Returns [] when nothing matches or when a sibling row lays equal claim to the
 * same line. The caller must then leave the row alone: a date borrowed from a
 * neighbouring transaction is worse than no correction at all.
 */
export function resolveByMoney(
  row: LedgerTxn,
  candidates: InvoiceTxn[],
  siblings: LedgerTxn[],
): InvoiceTxn[] {
  let cand = candidates.filter(i => near(i.fare, row.totalDoc));
  if (cand.length === 0) cand = candidates.filter(i => near(i.payable, row.amount));
  if (cand.length === 0) return [];
  const claimants = siblings.filter(o =>
    near(cand[0].fare, o.totalDoc) || near(cand[0].payable, o.amount));
  return claimants.length > 1 ? [] : cand;
}

export function reconcileIata(invoiceRows: InvoiceTxn[], ledgerRows: LedgerTxn[]): Reconciliation {
  const invByKey = new Map<string, InvoiceTxn[]>();
  for (const t of invoiceRows) {
    if (!t.date) continue;               // never guess a date
    const k = invoiceKey(t);
    const b = invByKey.get(k); if (b) b.push(t); else invByKey.set(k, [t]);
  }

  const dbByKey = new Map<string, LedgerTxn[]>();
  for (const t of ledgerRows) {
    const k = ledgerKey(t);
    const b = dbByKey.get(k); if (b) b.push(t); else dbByKey.set(k, [t]);
  }

  const r: Reconciliation = {
    dateUpdates: [], alreadyCorrect: [], unresolved: [],
    ledgerNoInvoice: [], missing: [], excludedVoid: [], toImport: [],
  };

  const place = (row: LedgerTxn, invoice: InvoiceTxn) => {
    if (row.date === invoice.date) r.alreadyCorrect.push({ row, invoice });
    else r.dateUpdates.push({ row, invoice });
  };

  for (const [k, rows] of dbByKey) {
    const inv = invByKey.get(k);
    if (!inv) { r.ledgerNoInvoice.push(...rows); continue; }
    if (rows.length === 1) { place(rows[0], earliest(inv)); continue; }
    for (const row of rows) {
      const res = resolveByMoney(row, inv, rows);
      if (res.length !== 1) { r.unresolved.push(row); continue; }
      place(row, earliest(res));
    }
  }

  // Duplicate protection: an invoice line counts as present when its
  // document+direction key exists in the IATA ledger. The ledger's amount may
  // legitimately differ (it often lacks the commission the invoice charges) —
  // that is a date/commission discrepancy, not a missing transaction.
  for (const [k, lines] of invByKey) {
    if (dbByKey.has(k)) continue;
    const line = earliest(lines);
    r.missing.push(line);
    if (isVoid(line)) r.excludedVoid.push(line);
    else r.toImport.push(line);
  }

  return r;
}
