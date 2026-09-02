import { SupportedCurrency } from './resolveCurrency';

/**
 * The header block a BSP sales report (TJQ) prints above its table.
 *
 *     Agy no  86219136        Report date range  31AUG      Currency  AED
 *     Office  DXBAD32AQ
 *     Agent   ALL             Current date       01-SEP-2026
 *
 * It matters because the table itself has NO date column — across forty of
 * these reports, not one carries a per-ticket date. The only date any of these
 * tickets has is the range printed here, so a parser that ignores the preamble
 * saves every row undated, and an undated row belongs to no month and shows up
 * in no period.
 *
 * The currency is stated here too, and is likewise the only place it appears.
 */
export interface ReportPeriod {
  /** First day the report covers, YYYY-MM-DD, or '' when it cannot be read. */
  from: string;
  /** Last day covered. Equal to `from` when the report covers a single day. */
  to: string;
  /** Currency the report is denominated in, when it says. */
  currency?: SupportedCurrency;
  /** True when the report covers exactly one day, so `from` is that day and
   *  not an approximation. */
  exact: boolean;
}

const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const CURRENCIES: SupportedCurrency[] = ['SAR', 'AED', 'USD', 'EUR'];

/** The first non-empty cell after a labelled one, reading the block in order. */
function valueAfter(flat: string[], label: string): string {
  const i = flat.findIndex(x => x.toLowerCase() === label.toLowerCase());
  if (i < 0) return '';
  return flat.slice(i + 1).find(x => x !== '') ?? '';
}

/**
 * "31AUG" against a report run on "01-SEP-2026" -> 2026-08-31.
 *
 * The range carries no year, so it comes from the report's own run date. A
 * month LATER than the run month has to be the previous year — a report run on
 * 01 January covers the end of December.
 */
function withYear(dayMon: string, runDate: string): string {
  const m = dayMon.trim().match(/^(\d{1,2})([A-Za-z]{3})$/);
  const year = runDate.match(/(\d{4})/)?.[1];
  if (!m || !year) return '';
  const mo = MON.indexOf(m[2].toUpperCase());
  if (mo < 0) return '';
  const runMon = runDate.match(/-\s*([A-Za-z]{3})\s*-/)?.[1];
  const runMo = runMon ? MON.indexOf(runMon.toUpperCase()) : mo;
  const y = runMo >= 0 && mo > runMo ? String(Number(year) - 1) : year;
  return `${y}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function readReportPeriod(preamble: string[][]): ReportPeriod {
  const flat = (preamble ?? []).flat().map(x => String(x ?? '').trim());
  const runDate = valueAfter(flat, 'Current date');
  const raw = valueAfter(flat, 'Report date range');

  const cur = valueAfter(flat, 'Currency').toUpperCase();
  const currency = (CURRENCIES as string[]).includes(cur) ? cur as SupportedCurrency : undefined;

  const parts = raw.split('-').map(s => s.trim()).filter(Boolean);
  if (parts.length === 1) {
    const d = withYear(parts[0], runDate);
    return { from: d, to: d, currency, exact: !!d };
  }
  if (parts.length === 2) {
    const from = withYear(parts[0], runDate);
    const to = withYear(parts[1], runDate);
    return { from, to: to || from, currency, exact: !!from && from === to };
  }
  return { from: '', to: '', currency, exact: false };
}
