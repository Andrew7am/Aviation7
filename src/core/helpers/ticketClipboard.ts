import { Ticket } from '../../types';

/**
 * The four things that identify a ticket, for the clipboard.
 *
 * Airline, number, passenger, PNR - and nothing else. This carried eleven
 * fields at first, on the reasoning that more is safer. It is not: the person
 * copying is sending a ticket to somebody, and the amount, the invoice
 * reference and the closure state are our bookkeeping rather than the
 * ticket's identity. Pasting them into a message to a supplier tells them
 * things they have no business reading, and buries the four they need.
 *
 * Tab-separated, so one format serves both uses: pasted into Excel it lands
 * as four columns, pasted into a chat it reads as a spaced line.
 */
export function ticketLine(t: Ticket): string {
  return [
    t.airlineCode || '',
    t.ticketNo || '',
    t.passengerName || '',
    t.pnr || '',
  ].join('\t');
}

/**
 * The rows a copy is allowed to carry.
 *
 * A top-up is a payment against the wallet, not a ticket: it has no number,
 * no passenger and no PNR, so it would copy as an empty line and land in
 * somebody's sheet as a blank row they are meant to read something into.
 * Dropped here rather than at each call, so a screen added later cannot
 * reintroduce it by forgetting.
 */
export function copyableTickets(rows: Ticket[]): Ticket[] {
  return rows.filter(t => (t.status || '').toUpperCase() !== 'FUND');
}

/**
 * A set of tickets for the clipboard, one to a line.
 *
 * The same four fields as a single ticket, because the destination is the
 * same: a message to a supplier, or a column in somebody's sheet. Newline
 * between rows and tab between fields is what every spreadsheet reads as a
 * grid, so a whole vendor's worth of tickets pastes into Excel as four
 * columns and into a chat as a readable block.
 */
export function ticketLines(rows: Ticket[]): string {
  return copyableTickets(rows).map(ticketLine).join('\n');
}
