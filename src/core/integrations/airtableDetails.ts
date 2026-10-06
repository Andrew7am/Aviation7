/**
 * The passenger name, cabin and route a ticket of ours lacks, filled from the
 * team's Airtable - by its number, and only where ours is empty.
 *
 * No notice and no approval: a blank filled from the row that names the same
 * document is not a decision, and asking for one a few hundred times trained
 * nobody to read them. A value already there is never touched.
 *
 *   name   only where their row is one passenger for certain (one document
 *          or a conjunction pair) - a cell of six tickets carries one name
 *   cabin  from their cabin column, where it names one cabin
 *   route  first origin airport / first destination airport, as their
 *          sheet has been read before ("JFK/LAS")
 *
 * Where their rows naming the same document disagree, nothing is filled.
 */
import type { AirtableTicketRow } from './airtable';
import { docKey, onePassenger, usableName, usableCabin } from './airtableNotices';

export interface DetailRow extends Pick<AirtableTicketRow, 'serials' | 'ticket_cell' | 'status' | 'client_name' | 'cabin'> {
  sheet_row: Record<string, string>;
}
export interface OursLacking { id: string; ticketNo: string; passengerName: string; cabinClass: string; route: string }
export type DetailField = 'passenger_name' | 'cabin_class' | 'route';
export interface DetailFill { id: string; ticketNo: string; field: DetailField; value: string }

const first = (v: string) => (v || '').split(',').map(x => x.trim().toUpperCase()).find(Boolean) ?? '';
export const routeOf = (r: DetailRow) => {
  const o = first(r.sheet_row?.['Origin Airports (from Aviation Quotations)'] ?? '');
  const d = first(r.sheet_row?.['Destination Airports (from Aviation Quotations)'] ?? '');
  return o && d && o !== d && /^[A-Z]{3}$/.test(o) && /^[A-Z]{3}$/.test(d) ? `${o}/${d}` : '';
};

export function detailsFor(ours: OursLacking[], rows: DetailRow[]): DetailFill[] {
  const byDoc = new Map<string, { name: Set<string>; cabin: Set<string>; route: Set<string> }>();
  for (const r of rows) {
    if (/hold/i.test(r.status || '')) continue;
    const name = onePassenger(r as AirtableTicketRow) ? usableName(r.client_name) : '';
    const cabin = usableCabin(r.cabin);
    const route = routeOf(r);
    for (const s of r.serials) {
      const k = docKey(s);
      if (!k) continue;
      const e = byDoc.get(k) ?? { name: new Set(), cabin: new Set(), route: new Set() };
      if (name) e.name.add(name);
      if (cabin) e.cabin.add(cabin);
      if (route) e.route.add(route);
      byDoc.set(k, e);
    }
  }
  const single = (s: Set<string>) => (s.size === 1 ? [...s][0] : '');
  const out: DetailFill[] = [];
  for (const t of ours) {
    const e = byDoc.get(docKey(t.ticketNo));
    if (!e) continue;
    const add = (field: DetailField, have: string, v: string) => { if (!have.trim() && v) out.push({ id: t.id, ticketNo: t.ticketNo, field, value: v }); };
    add('passenger_name', t.passengerName, single(e.name));
    add('cabin_class', t.cabinClass, single(e.cabin));
    add('route', t.route, single(e.route));
  }
  return out;
}
