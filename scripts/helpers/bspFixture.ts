/**
 * Test fixture: build a BSP invoice grid the way a real PDF produces one.
 *
 * The parser reads money from the column each number physically sits under, so
 * a fixture made of bare text lines would not exercise the real path at all.
 * Every transaction here is described by COLUMN — "this is the Standard
 * Commission amount", not "this is the fifth number" — which is also how the
 * invoice itself is defined, and means a test states what it means.
 *
 * The x coordinates are the ones the agent's own invoices use.
 */
import { encodeRuns, type PdfRun } from '../../src/core/helpers/pdfText';

/** Column positions, taken from the invoice's heading row. */
export const X = {
  air: 24, trnc: 45, doc: 66, date: 114, cpui: 150, code: 179, stat: 204, fop: 222,
  txn: 270, fare: 324, tax: 386, fc: 439, pen: 493, cobl: 540,
  stdRate: 570, stdAmt: 619, suppRate: 642, suppAmt: 698, taxOnComm: 746, payable: 797,
} as const;

/** The two heading rows the parser locates its columns from. */
const HEADING_1: PdfRun[] = [
  { x: 72, text: 'Document' }, { x: 114, text: 'Issue' }, { x: 184, text: 'NR' },
  { x: 260, text: 'Transaction' }, { x: 328, text: 'FARE' },
  { x: 410, text: 'Taxes, Fees & Charges' }, { x: 543, text: 'COBL' },
  { x: 582, text: '--STD Comm--' }, { x: 653, text: '--SUPP Comm--' },
  { x: 746, text: 'Tax on' }, { x: 797, text: 'Balance' },
];
const HEADING_2: PdfRun[] = [
  { x: 24, text: 'AIR' }, { x: 45, text: 'TRNC' }, { x: 74, text: 'Number' },
  { x: 114, text: 'Date' }, { x: 150, text: 'CPUI' }, { x: 179, text: 'Code' },
  { x: 196, text: 'STAT' }, { x: 217, text: 'FOP' },
  { x: 270, text: 'Amount' }, { x: 324, text: 'Amount' },
  { x: 386, text: 'TAX' }, { x: 439, text: 'F&C' }, { x: 493, text: 'PEN' },
  { x: 540, text: 'Amount' },
  { x: 570, text: 'Rate' }, { x: 619, text: 'Amt' },
  { x: 642, text: 'Rate' }, { x: 698, text: 'Amt' },
  { x: 746, text: 'Comm' }, { x: 797, text: 'Payable' },
];

export interface TxnSpec {
  air?: string;
  trnc: string;
  doc: string;
  /** BSP form, e.g. "09AUG26". */
  date: string;
  cpui?: string;
  stat?: string;
  /** Form of payment. "CC" is a card sale, which settles nothing through BSP. */
  fop?: string;
  /** Transaction Amount — the gross. */
  txn?: number;
  fare?: number;
  taxes?: { tax?: number; fc?: number; pen?: number };
  cobl?: number;
  stdRate?: number;
  stdAmt?: number;
  suppRate?: number;
  suppAmt?: number;
  taxOnComm?: number;
  payable?: number;
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One transaction line, each value placed under its own column. */
export function txn(spec: TxnSpec): PdfRun[] {
  const runs: PdfRun[] = [
    { x: X.air, text: spec.air ?? '065' },
    { x: X.trnc, text: spec.trnc },
    { x: X.doc, text: spec.doc },
    { x: X.date, text: spec.date },
  ];
  if (spec.cpui) runs.push({ x: X.cpui, text: spec.cpui });
  runs.push({ x: X.stat, text: spec.stat ?? 'I' });
  if (spec.fop) runs.push({ x: X.fop, text: spec.fop });
  const put = (x: number, v: number | undefined) => {
    if (v !== undefined) runs.push({ x, text: fmt(v) });
  };
  put(X.txn, spec.txn);
  put(X.fare, spec.fare);
  put(X.tax, spec.taxes?.tax);
  put(X.fc, spec.taxes?.fc);
  put(X.pen, spec.taxes?.pen);
  put(X.cobl, spec.cobl);
  put(X.stdRate, spec.stdRate);
  put(X.stdAmt, spec.stdAmt);
  put(X.suppRate, spec.suppRate);
  put(X.suppAmt, spec.suppAmt);
  put(X.taxOnComm, spec.taxOnComm);
  put(X.payable, spec.payable);
  return runs.sort((a, b) => a.x - b.x);
}

/** A plain line with no column meaning — section markers, CATEGORY, totals. */
export const line = (text: string): PdfRun[] => [{ x: 0, text }];

/**
 * Assemble a full invoice grid: the identifying header block, the column
 * headings, then whatever body rows the test supplies.
 */
export function invoiceGrid(body: (PdfRun[] | string)[]): string[][] {
  const rows: PdfRun[][] = [
    line('FCAGBILLDET AGENT BILLING DETAILS 86-2 1913 6 LUXURY EVENTS AND VIP TRAVEL FZC'),
    line('Billing Period: 260802(09-AUG-2026 to 15-AUG-2026) REFERENCE: 86219136 - 260802'),
    line('GRAND TOTAL (AED) 126,925.08 97,052.08 8,605.00 17,603.00 3,665.00'),
    HEADING_1,
    HEADING_2,
    ...body.map(b => (typeof b === 'string' ? line(b) : b)),
  ];
  return rows.map(runs => [
    runs.map(r => r.text).join(' ').replace(/\s+/g, ' ').trim(),
    encodeRuns(runs),
  ]);
}
