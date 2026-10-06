/**
 * The aviation team's Airtable "Aviation Tickets" table, read as their sheet.
 *
 * Their CSV export is what the Team Sheet Check was built on, so a record is
 * turned back into exactly the row that export prints - same headers, same
 * number and date formats, linked records by name - and read by the same
 * reader. A live copy that read differently from the file would be a second
 * comparison with its own answers.
 *
 * Pure: no network, no database. The sync fetches, this shapes.
 */
import { teamSerials } from '../parsers/teamSheet';

export const AIRTABLE_BASE = 'appRdNQrrjKM4wGAe';
export const AIRTABLE_TICKETS_TABLE = 'tblNx337qwL2lonJs';

/** Tables whose records the tickets link to, read by name: id -> primary field. */
export const AIRTABLE_NAME_TABLES: Record<string, string> = {
  tbl9Zi5fKPtklo8OW: 'Airline Name',        // Airlines
  tblNsqsJK0DUqU26I: 'Portal Name',         // Airline Portals
  tblT2geESbZAuiEST: 'Name',                // TEAM MEMBERS
  tblfPxzJpI37LrXeD: 'Account Name',        // MICE ACCOUNTS
  tblKWEGF8WmPP28qe: 'City Name',           // Cities
  tblju4wNsn4l1KjKD: 'Airport IATA Code',   // Airports
};

/** Their export's columns, in its order. */
export const SHEET_HEADERS = [
  'Ticket Number', 'PNR', 'Status', 'Time Limit (If On Hold)', 'Department',
  'MICE Account (from Aviation Requests) (from Aviation Quotations)', 'Net Cost', 'TAX',
  'Total Cost with Currency', 'Rate with MU (Manual Entry)', 'Issued Date & Time',
  'Refund Recieved?', 'Refund Amount', 'Ticket Type', 'Ticket Destination', 'TEAM MEMBERS',
  'Airline', 'Portal', 'Origin Cities (from Aviation Quotations)', 'Origin Airports (from Aviation Quotations)',
  'Destination City (from Aviation Quotations)', 'Destination Airports (from Aviation Quotations)',
  'Cabin Class (Automated)', 'EMD Number', 'REQ No (Auto) (MICE) (from Aviation Quotations)',
  'REQ No (Auto) (Trip) (from Aviation Quotations)', 'Extracted Client Name',
] as const;

export interface AirtableRecord { id: string; createdTime?: string; fields: Record<string, unknown> }
export type NameMap = Map<string, string>;

/** Their export prints times in Cairo time - +2 in winter, +3 in summer -
 *  as "26/9/2026 12:50pm". 21:10 UTC on 5 March is "5/3/2026 11:10pm". */
export function sheetTime(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', day: 'numeric', month: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${Number(p.day)}/${Number(p.month)}/${p.year} ${Number(p.hour)}:${p.minute}${String(p.dayPeriod || '').toLowerCase().replace(/\./g, '')}`;
}

/** An AI field is { state, value }; anything else is itself. */
const plain = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as Record<string, unknown>)
    ? (v as { value: unknown }).value : v;

/** A value as their export prints it. Linked records by name. */
function cell(v: unknown, names: NameMap, decimals?: number): string {
  v = plain(v);
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => cell(x, names)).filter(Boolean).join(',');
  if (typeof v === 'string') return /^rec[A-Za-z0-9]{14}$/.test(v) ? (names.get(v) ?? '') : v;
  if (typeof v === 'number') return decimals != null ? v.toFixed(decimals) : String(v);
  if (typeof v === 'boolean') return v ? 'checked' : '';
  return '';
}

/** The record as one row of their CSV export. */
export function toSheetRow(f: Record<string, unknown>, names: NameMap): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of SHEET_HEADERS) {
    const v = f[h];
    if (h === 'Issued Date & Time' || h === 'Time Limit (If On Hold)') row[h] = sheetTime(v);
    else if (h === 'Net Cost' || h === 'Rate with MU (Manual Entry)' || h === 'Refund Amount') row[h] = cell(v, names, 2);
    else if (h === 'TAX') row[h] = cell(v, names, 1);
    else row[h] = cell(v, names);
  }
  return row;
}

/** What we keep of a record, compared between syncs to see what moved. */
export interface AirtableTicketRow {
  record_id: string;
  sheet_row: Record<string, string>;
  ticket_cell: string;
  serials: string[];
  pnr: string;
  status: string;
  req_num: string;
  net_cost: number | null;
  currency: string;
  refund_amount: number | null;
  issued_at: string | null;
  client_name: string;
  cabin: string;
  portal: string;
  airline: string;
  team_member: string;
  old_ticket: string;
  old_pnr: string;
  created_at: string | null;
  last_modified: string | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => String(plain(v) ?? '').trim();

export function normalize(r: AirtableRecord, names: NameMap): AirtableTicketRow {
  const f = r.fields;
  const sheet = toSheetRow(f, names);
  const reqs = [sheet['REQ No (Auto) (MICE) (from Aviation Quotations)'], sheet['REQ No (Auto) (Trip) (from Aviation Quotations)']]
    .flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean);
  const total = sheet['Total Cost with Currency'];
  return {
    record_id: r.id,
    sheet_row: sheet,
    ticket_cell: str(f['Ticket Number']),
    serials: [...new Set(teamSerials(str(f['Ticket Number'])).map(d => d.serial).filter(Boolean))],
    pnr: str(f['PNR']).replace(/\s+/g, '').toUpperCase(),
    status: str(f['Status']),
    req_num: [...new Set(reqs)].join(', ').toUpperCase(),
    net_cost: num(f['Net Cost']),
    currency: str(f['Currency']) || (/\b([A-Z]{3})\b/.exec(total)?.[1] ?? ''),
    refund_amount: num(f['Refund Amount']),
    issued_at: str(f['Issued Date & Time']) || null,
    client_name: str(f['Extracted Client Name']),
    cabin: str(f['Cabin Class (Automated)']),
    portal: sheet['Portal'],
    airline: sheet['Airline'],
    team_member: sheet['TEAM MEMBERS'].trim(),
    old_ticket: str(f['Old Ticket Number']),
    old_pnr: str(f['Old PNR']),
    created_at: str(f['Created']) || r.createdTime || null,
    last_modified: str(f['Last Modified']) || null,
  };
}

/** The fields whose change is worth recording, and how they are named. */
export const TRACKED: [keyof AirtableTicketRow, string][] = [
  ['ticket_cell', 'Ticket number'], ['pnr', 'PNR'], ['status', 'Status'], ['req_num', 'Request'],
  ['net_cost', 'Net cost'], ['currency', 'Currency'], ['refund_amount', 'Refund amount'],
  ['client_name', 'Client name'], ['cabin', 'Cabin'], ['portal', 'Portal'], ['issued_at', 'Issued'],
];

export interface FieldChange { field: keyof AirtableTicketRow; label: string; old: string; new: string }

const shown = (v: unknown) => (v == null ? '' : String(v));

/** What changed on one record between two syncs. A new record has none. */
export function diffRecord(before: AirtableTicketRow | undefined, after: AirtableTicketRow): FieldChange[] {
  if (!before) return [];
  const out: FieldChange[] = [];
  for (const [k, label] of TRACKED) {
    const a = shown(before[k]), b = shown(after[k]);
    // A date comes back from the database in another spelling of the same
    // moment; two empty ones are the same too.
    const same = k === 'issued_at' && a && b ? new Date(a).getTime() === new Date(b).getTime() : a === b;
    if (!same) out.push({ field: k, label, old: a, new: b });
  }
  return out;
}

/** Their rows as the CSV their export would have been - for the sheet reader. */
export function rowsToCsv(rows: Record<string, string>[], unparse: (data: unknown) => string): string {
  return unparse({ fields: [...SHEET_HEADERS], data: rows.map(r => SHEET_HEADERS.map(h => r[h] ?? '')) });
}
