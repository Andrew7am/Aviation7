/**
 * Their Airtable as a CSV export, when the API cannot be used.
 *
 * On 26 Oct 2026 the team's Airtable token stopped working (401, "Invalid
 * authentication token"), with no word on whether it comes back. The rows we
 * keep were always shaped as their export prints them (airtable.ts), so the
 * export itself can stand in: each of its rows is matched to the record we
 * already hold, and goes through the same sync as a record read live - the
 * bell, the requests filled, the Emirates limit, the request alerts.
 *
 * An export has no record id. A row is the record we hold that prints the
 * same row; failing that, the one with the same ticket, PNR, issue time and
 * EMD - the same row with something changed; failing that, a new record,
 * named from its content so the same row uploaded twice is the same record.
 * Only an export of the whole table can say a record is gone.
 *
 * Pure: no network, no database.
 */
import { teamSerials } from '../parsers/teamSheet';
import { SHEET_HEADERS, sheetTime, type AirtableTicketRow } from './airtable';

const str = (v: string | undefined) => (v ?? '').trim();
const num = (v: string | undefined) => {
  const n = Number(str(v).replace(/,/g, ''));
  return str(v) === '' || Number.isNaN(n) ? null : n;
};

/** The export's own columns, in their order, exactly as printed - a trailing
 *  space or line break is part of the row it is matched by. Anything else the
 *  export carries is dropped. */
export function sheetOf(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(SHEET_HEADERS.map(h => [h, raw[h] ?? '']));
}

const printed = (s: Record<string, string>) => SHEET_HEADERS.map(h => s[h] ?? '').join('\u0001');
const sameRow = (s: Record<string, string>) => [s['Ticket Number'], s['PNR'], s['Issued Date & Time'], s['EMD Number']].join('\u0001');

/** "26/10/2026 1:09am" in Cairo time, as an instant - whichever of +3 and +2
 *  prints back the same. */
export function fromSheetTime(t: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(am|pm)$/i.exec(str(t));
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[6].toLowerCase() === 'pm') h += 12;
  for (const off of [3, 2]) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h - off, Number(m[5])));
    if (sheetTime(d.toISOString()) === str(t)) return d.toISOString();
  }
  return null;
}

/** A content name for a record we have never held, stable across uploads. */
function contentId(s: Record<string, string>): string {
  let h = 2166136261;
  for (const c of printed(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `csv_${(h >>> 0).toString(36)}`;
}

/** One export row as a record, keeping what the export does not carry from the record it is. */
export function rowFromSheet(s: Record<string, string>, id: string, was?: AirtableTicketRow, now = new Date().toISOString()): AirtableTicketRow {
  const reqs = [s['REQ No (Auto) (MICE) (from Aviation Quotations)'], s['REQ No (Auto) (Trip) (from Aviation Quotations)']]
    .flatMap(x => (x ?? '').split(',')).map(x => x.trim()).filter(Boolean);
  const issued = was && was.sheet_row?.['Issued Date & Time'] === s['Issued Date & Time'] ? was.issued_at : fromSheetTime(s['Issued Date & Time']);
  const unchanged = !!was && printed(was.sheet_row ?? {}) === printed(s);
  return {
    record_id: id,
    sheet_row: s,
    // As normalize() keeps them: trimmed where it trims, as printed where it does not.
    ticket_cell: str(s['Ticket Number']),
    serials: [...new Set(teamSerials(s['Ticket Number']).map(d => d.serial).filter(Boolean))],
    pnr: str(s['PNR']).replace(/\s+/g, '').toUpperCase(),
    status: str(s['Status']),
    req_num: [...new Set(reqs)].join(', ').toUpperCase(),
    // The export prints two decimals; the API gave 89.008. Printed the same, it is the same.
    net_cost: was && was.sheet_row?.['Net Cost'] === s['Net Cost'] ? was.net_cost : num(s['Net Cost']),
    currency: /\b([A-Z]{3})\b/.exec(s['Total Cost with Currency'])?.[1] ?? was?.currency ?? '',
    refund_amount: was && was.sheet_row?.['Refund Amount'] === s['Refund Amount'] ? was.refund_amount : num(s['Refund Amount']),
    issued_at: issued,
    client_name: str(s['Extracted Client Name']),
    account: str(s['MICE Account (from Aviation Requests) (from Aviation Quotations)']),
    department: str(s['Department']),
    cabin: str(s['Cabin Class (Automated)']),
    portal: s['Portal'],
    airline: s['Airline'],
    team_member: str(s['TEAM MEMBERS']),
    old_ticket: was?.old_ticket ?? '',
    old_pnr: was?.old_pnr ?? '',
    created_at: was?.created_at ?? issued ?? now,
    last_modified: unchanged ? (was?.last_modified ?? null) : now,
  };
}

/**
 * The export's rows as records. `whole` says the export is their whole table:
 * as many rows as we hold, give or take a tenth - only then is a record we
 * hold and the export lacks taken as deleted.
 */
export function matchExport(raw: Record<string, string>[], held: AirtableTicketRow[], now = new Date().toISOString()) {
  const live = held.filter(r => !(r as { deleted?: boolean }).deleted);
  const byPrinted = new Map<string, AirtableTicketRow[]>(), bySame = new Map<string, AirtableTicketRow[]>();
  for (const r of live) {
    const s = r.sheet_row ?? {};
    (byPrinted.get(printed(s)) ?? byPrinted.set(printed(s), []).get(printed(s))!).push(r);
    (bySame.get(sameRow(s)) ?? bySame.set(sameRow(s), []).get(sameRow(s))!).push(r);
  }
  const used = new Set<string>();
  const take = (list?: AirtableTicketRow[]) => list?.find(r => !used.has(r.record_id));
  const sheets = raw.map(sheetOf).filter(s => SHEET_HEADERS.some(h => str(s[h])));
  const rows: AirtableTicketRow[] = [];
  // Exact rows first, so a changed row never takes the record an unchanged twin of it is.
  const pending: Record<string, string>[] = [];
  for (const s of sheets) {
    const r = take(byPrinted.get(printed(s)));
    if (r) { used.add(r.record_id); rows.push(rowFromSheet(s, r.record_id, r, now)); } else pending.push(s);
  }
  for (const s of pending) {
    const r = take(bySame.get(sameRow(s)));
    let id = r?.record_id ?? contentId(s);
    while (!r && used.has(id)) id += '_';
    used.add(id);
    rows.push(rowFromSheet(s, id, r, now));
  }
  const whole = live.length === 0 || sheets.length >= live.length * 0.9;
  return { rows, whole, gone: whole ? live.filter(r => !used.has(r.record_id)) : [] };
}
