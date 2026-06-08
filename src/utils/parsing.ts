import { v4 as uuidv4 } from 'uuid';
import { Ticket } from '../types';
import Papa from 'papaparse';

/* ─────────────────────────────────────────────
   STATUS NORMALISATION
───────────────────────────────────────────── */
function normaliseStatus(raw: string): string {
  const s = raw.trim().toUpperCase();
  const MAP: Record<string, string> = {
    'TKTT': 'TKTT', 'ISSU': 'TKTT',
    'VOID': 'VOID',
    'REF': 'RFND', 'RFND': 'RFND', 'REFUND': 'RFND',
    'CANN': 'CANN', 'CANX': 'CANN', 'CANCEL': 'CANN',
    'CNJ': 'CNJ', 'EMDS': 'EMDS',
  };
  return MAP[s] ?? s;
}

/* ─────────────────────────────────────────────
   AMOUNT LOGIC based on status
───────────────────────────────────────────── */
function applyStatusAmountLogic(amount: number, status: string): number {
  const s = status.toUpperCase();
  if (s === 'CANN') return 0;
  if (s === 'RFND' || s === 'VOID') return -Math.abs(amount);
  return amount;
}

/* ─────────────────────────────────────────────
   DETECT FORMAT from header row
───────────────────────────────────────────── */
type ParseFormat =
  | 'EXPORT'      // our own export (Ticket No. + Req Num headers)
  | 'IATA'        // SEQ NO / TRNC / DOC NUMBER headers
  | 'FLYADEAL'    // paymentDate + pnr + bookingAmount / accountAmount
  | 'FLYNAS'      // nasFlightDate / nasTicketNum style
  | 'AIRARABIA'   // airArabia specific cols
  | 'FLYDUBAI'    // flydubai cols
  | 'RTS'         // rts / ibtekar / goldmedal consolidated
  | 'IBTEKAR'
  | 'GOLDMEDAL'
  | 'REGEX';      // no known header → pure regex fallback

function detectFormat(headers: string[], defaultSource?: string): ParseFormat {
  const h = headers.map(c => (c || '').trim().toLowerCase());
  const hUpper = headers.map(c => (c || '').trim().toUpperCase());

  if (h.includes('ticket no.') && h.includes('req num')) return 'EXPORT';

  if (hUpper.some(c => c.includes('SEQ NO') || c.includes('TRNC') || c.includes('DOC NUMBER')))
    return 'IATA';
  if (hUpper.some(c => c === 'SEQ NO') || hUpper.some(c => c === 'TRNC')) return 'IATA';

  if (h.includes('paymentdate') && h.includes('pnr')) return 'FLYADEAL';
  if (h.some(c => c.includes('payment') && c.includes('date')) && h.includes('pnr')) return 'FLYADEAL';

  if (h.some(c => c.includes('nasticket') || c.includes('nas_ticket') || c.includes('nasflightdate')))
    return 'FLYNAS';
  if (h.some(c => c.includes('flightdate')) && h.some(c => c.includes('ticketno')))
    return 'FLYNAS';

  if (h.some(c => c.includes('arabiaticket') || c.includes('air arabia') || (c.includes('air') && c.includes('arabia'))))
    return 'AIRARABIA';

  if (h.some(c => c.includes('flydubai') || c.includes('fly_dubai'))) return 'FLYDUBAI';

  if (h.some(c => c.includes('ibtekar'))) return 'IBTEKAR';
  if (h.some(c => c.includes('goldmedal') || c.includes('gold_medal') || c.includes('gold medal')))
    return 'GOLDMEDAL';
  if (h.some(c => c.includes('rts'))) return 'RTS';

  // defaultSource override
  if (defaultSource) {
    const ds = defaultSource.toUpperCase();
    if (ds === 'IATA') return 'IATA';
    if (ds.includes('FLYADEAL')) return 'FLYADEAL';
    if (ds === 'FLYNAS') return 'FLYNAS';
    if (ds === 'AIRARABIA') return 'AIRARABIA';
    if (ds === 'FLYDUBAI') return 'FLYDUBAI';
    if (ds === 'RTS') return 'RTS';
    if (ds === 'IBTEKAR') return 'IBTEKAR';
    if (ds === 'GOLDMEDAL') return 'GOLDMEDAL';
  }

  return 'REGEX';
}

/* ─────────────────────────────────────────────
   COLUMN INDEX HELPERS
───────────────────────────────────────────── */
function colIdx(headers: string[], ...needles: string[]): number {
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const idx = headers.findIndex(h => h.toLowerCase().includes(n));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cell(row: string[], idx: number): string {
  return idx >= 0 && idx < row.length ? (row[idx] ?? '').trim() : '';
}

function parseNum(raw: string): number {
  return parseFloat(raw.replace(/,/g, '').trim()) || 0;
}

/* ─────────────────────────────────────────────
   REQ NUM EXTRACTOR (shared across formats)
───────────────────────────────────────────── */
function extractReqNum(rowText: string, pnr: string): string {
  // explicit "req:" prefix
  const explicit = rowText.match(/req:\s*([a-zA-Z0-9]+)/i);
  if (explicit) return explicit[1].toUpperCase().replace(/\s+/g, '');

  // known prefixes: sa, ksaml, uae, re + digits
  const prefixed = rowText.match(/\b(sa\s*\d+|ksaml\s*\d+|uae\s*\d+|req\s*\d+)\b/i) ||
    rowText.match(/\bre([0-9]{3,6})\b/i);
  if (prefixed) return prefixed[1].toUpperCase().replace(/\s+/g, '');

  // broad fallback: 2-6 letters followed by 2-7 digits, not matching PNR
  const broad = rowText.match(/\b[A-Za-z]{2,6}\s*\d{2,7}\b/gi);
  if (broad) {
    const valid = broad.filter(m => m.replace(/\s+/g, '').toUpperCase() !== pnr);
    if (valid.length > 0) return valid[0].toUpperCase().replace(/\s+/g, '');
  }
  return '';
}

/* ─────────────────────────────────────────────
   PNR VALIDATOR
───────────────────────────────────────────── */
function isValidPNR(s: string): boolean {
  return /^[A-Z0-9]{5,6}$/i.test(s) && /[A-Z]/i.test(s);
}

/* ─────────────────────────────────────────────
   MAIN PARSE FUNCTION
───────────────────────────────────────────── */
export function parseManualInput(
  text: string,
  defaultSource?: string
): { tickets: Ticket[]; errors: string[] } {
  const tickets: Ticket[] = [];
  const errors: string[] = [];

  const result = Papa.parse(text.trim(), { skipEmptyLines: true });
  if (result.data.length === 0) return { tickets, errors };

  const allRows = result.data as string[][];
  const firstRow = allRows[0];
  const format = detectFormat(firstRow, defaultSource);

  // consume header row for known formats
  const dataRows = (format !== 'REGEX') ? allRows.slice(1) : allRows;

  const h = firstRow.map(c => (c || '').trim()); // original case for col matching

  /* ── per-format column indices ── */
  let iTicket = -1, iPNR = -1, iAmount = -1, iComm = -1, iTotalDoc = -1;
  let iStatus = -1, iDate = -1, iSource = -1, iReq = -1, iPassenger = -1;

  if (format === 'EXPORT') {
    iTicket = colIdx(h, 'Ticket No.');
    iReq = colIdx(h, 'Req Num');
    iPNR = colIdx(h, 'PNR');
    iAmount = colIdx(h, 'Amount');
    iSource = colIdx(h, 'Source');
    iStatus = colIdx(h, 'Status');
    iDate = colIdx(h, 'Date');
    iPassenger = colIdx(h, 'Passenger', 'Pax', 'Name');
    iComm = colIdx(h, 'Commission', 'Comm');
    iTotalDoc = colIdx(h, 'Total Doc', 'Total');
  } else if (format === 'IATA') {
    iTicket = colIdx(h, 'DOC NUMBER', 'DOCNUMBER');
    if (iTicket === -1) iTicket = 3;
    iTotalDoc = colIdx(h, 'TOTAL DOC', 'TOTALDOC');
    if (iTotalDoc === -1) iTotalDoc = 4;
    iComm = colIdx(h, 'COMM');
    if (iComm === -1) iComm = 7;
    iPNR = colIdx(h, 'RLOC');
    if (iPNR === -1) iPNR = 11;
    iStatus = colIdx(h, 'TRNC');
    if (iStatus === -1) iStatus = 12;
    iDate = colIdx(h, 'DATE', 'TRAVEL DATE', 'DEP DATE');
    iPassenger = colIdx(h, 'PASSENGER', 'PAX NAME', 'NAME');
  } else if (format === 'FLYADEAL') {
    iPNR = colIdx(h, 'pnr');
    iDate = colIdx(h, 'paymentdate', 'payment_date', 'date');
    iAmount = colIdx(h, 'accountamount', 'bookingamount', 'amount');
    iStatus = colIdx(h, 'status');
    iPassenger = colIdx(h, 'passenger', 'pax', 'name', 'passengername');
    iReq = colIdx(h, 'req', 'reqnum', 'req_num', 'reference');
  } else if (format === 'FLYNAS') {
    iTicket = colIdx(h, 'ticketno', 'ticket_no', 'ticketnumber', 'nasticket');
    iPNR = colIdx(h, 'pnr', 'bookingref', 'booking_ref');
    iDate = colIdx(h, 'flightdate', 'nasflightdate', 'date', 'issuedate');
    iAmount = colIdx(h, 'amount', 'totalamount', 'fare', 'netamount');
    iComm = colIdx(h, 'comm', 'commission');
    iStatus = colIdx(h, 'status', 'ticketstatus');
    iPassenger = colIdx(h, 'passenger', 'passengername', 'pax');
    iReq = colIdx(h, 'req', 'reqnum', 'req_num', 'reference');
  } else if (format === 'AIRARABIA') {
    iTicket = colIdx(h, 'ticketno', 'ticket_no', 'ticket number', 'arabiaticket');
    iPNR = colIdx(h, 'pnr', 'bookingref');
    iDate = colIdx(h, 'date', 'issuedate', 'flightdate');
    iAmount = colIdx(h, 'amount', 'totalamount', 'fare');
    iComm = colIdx(h, 'comm', 'commission');
    iStatus = colIdx(h, 'status');
    iPassenger = colIdx(h, 'passenger', 'pax', 'name');
    iReq = colIdx(h, 'req', 'reqnum', 'reference');
  } else if (format === 'FLYDUBAI') {
    iTicket = colIdx(h, 'ticketno', 'ticket', 'document');
    iPNR = colIdx(h, 'pnr', 'locator', 'bookingref');
    iDate = colIdx(h, 'date', 'issuedate', 'traveldate');
    iAmount = colIdx(h, 'amount', 'total', 'fare', 'nettotal');
    iComm = colIdx(h, 'comm', 'commission');
    iStatus = colIdx(h, 'status', 'type');
    iPassenger = colIdx(h, 'passenger', 'pax', 'name');
    iReq = colIdx(h, 'req', 'reqnum', 'reference');
  } else if (format === 'RTS' || format === 'IBTEKAR' || format === 'GOLDMEDAL') {
    // Generic consolidated format — use best-effort col matching
    iTicket = colIdx(h, 'ticketno', 'ticket no', 'ticket_no', 'document', 'doc no');
    iPNR = colIdx(h, 'pnr', 'locator', 'bookingref', 'booking ref');
    iDate = colIdx(h, 'date', 'issuedate', 'issue date', 'traveldate');
    iAmount = colIdx(h, 'amount', 'net', 'total', 'fare', 'nettotal', 'net amount');
    iComm = colIdx(h, 'comm', 'commission');
    iStatus = colIdx(h, 'status', 'type', 'trnc');
    iPassenger = colIdx(h, 'passenger', 'pax', 'name', 'passengername');
    iReq = colIdx(h, 'req', 'reqnum', 'req_num', 'reference');
  }

  /* ── process each data row ── */
  dataRows.forEach((row: string[], index: number) => {
    if (!Array.isArray(row) || row.every(c => !c?.trim())) return;

    const rowText = row.join(' ');
    const rowNumber = index + 2;

    let ticketNo = '';
    let pnr = '';
    let amount = 0;
    let commission = 0;
    let totalDoc = 0;
    let status = '';
    let date = new Date().toISOString().split('T')[0];
    let source = defaultSource || '';
    let reqNum = '';
    let passengerName = '';

    /* ══════════════ FORMAT PARSERS ══════════════ */

    if (format === 'EXPORT') {
      ticketNo = cell(row, iTicket);
      reqNum = cell(row, iReq);
      pnr = cell(row, iPNR);
      amount = parseNum(cell(row, iAmount));
      source = cell(row, iSource) || defaultSource || '';
      status = normaliseStatus(cell(row, iStatus));
      date = cell(row, iDate) || date;
      passengerName = cell(row, iPassenger);
      commission = parseNum(cell(row, iComm));
      totalDoc = parseNum(cell(row, iTotalDoc));
      if (totalDoc > 0 && commission >= 0) amount = totalDoc - commission;

    } else if (format === 'IATA') {
      ticketNo = cell(row, iTicket);
      pnr = cell(row, iPNR);
      totalDoc = parseNum(cell(row, iTotalDoc));
      commission = parseNum(cell(row, iComm));
      amount = totalDoc - commission;
      status = normaliseStatus(cell(row, iStatus));
      date = cell(row, iDate) || date;
      passengerName = cell(row, iPassenger);
      source = defaultSource || 'IATA';

      // PNR sanity check
      if (!isValidPNR(pnr)) {
        const m = rowText.match(/\b[A-Z0-9]{5,6}\b/);
        if (m && /[A-Z]/i.test(m[0])) pnr = m[0].toUpperCase();
      }
      // status sanity check
      if (!['TKTT', 'VOID', 'RFND', 'CANN', 'CNJ', 'EMDS'].includes(status)) {
        const sm = rowText.match(/\b(TKTT|ISSU|VOID|REF|RFND|CANN|CANX|CNJ|EMDS)\b/i);
        if (sm) status = normaliseStatus(sm[1]);
      }
      reqNum = extractReqNum(rowText, pnr);

    } else if (format === 'FLYADEAL') {
      pnr = cell(row, iPNR);
      ticketNo = pnr; // LCC — PNR is the identifier
      amount = parseNum(cell(row, iAmount));
      status = normaliseStatus(cell(row, iStatus));
      date = cell(row, iDate) || date;
      passengerName = cell(row, iPassenger);
      source = defaultSource || (defaultSource?.toUpperCase().includes('DXB') ? 'FlyAdeal DXB' : 'FlyAdeal KSA');
      reqNum = cell(row, iReq) || extractReqNum(rowText, pnr);

    } else if (format === 'FLYNAS') {
      ticketNo = cell(row, iTicket);
      pnr = cell(row, iPNR);
      totalDoc = parseNum(cell(row, iAmount));
      commission = parseNum(cell(row, iComm));
      amount = commission > 0 ? totalDoc - commission : totalDoc;
      status = normaliseStatus(cell(row, iStatus));
      date = cell(row, iDate) || date;
      passengerName = cell(row, iPassenger);
      source = defaultSource || 'Flynas';
      reqNum = cell(row, iReq) || extractReqNum(rowText, pnr);

    } else if (format === 'AIRARABIA') {
      ticketNo = cell(row, iTicket);
      pnr = cell(row, iPNR);
      totalDoc = parseNum(cell(row, iAmount));
      commission = parseNum(cell(row, iComm));
      amount = commission > 0 ? totalDoc - commission : totalDoc;
      status = normaliseStatus(cell(row, iStatus));
      date = cell(row, iDate) || date;
      passengerName = cell(row, iPassenger);
      source = defaultSource || 'AirArabia';
      reqNum = cell(row, iReq) || extractReqNum(rowText, pnr);

    } else if (format === 'FLYDUBAI') {
      ticketNo = cell(row, iTicket);
      pnr = cell(row, iPNR);
      totalDoc = parseNum(cell(row, iAmount));
      commission = parseNum(cell(row, iComm));
      amount = commission > 0 ? totalDoc - commission : totalDoc;
      status = normaliseStatus(cell(row, iStatus));
      date = cell(row, iDate) || date;
      passengerName = cell(row, iPassenger);
      source = defaultSource || 'FlyDubai';
      reqNum = cell(row, iReq) || extractReqNum(rowText, pnr);

    } else if (format === 'RTS' || format === 'IBTEKAR' || format === 'GOLDMEDAL') {
      ticketNo = cell(row, iTicket);
      pnr = cell(row, iPNR);
      totalDoc = parseNum(cell(row, iAmount));
      commission = parseNum(cell(row, iComm));
      amount = commission > 0 ? totalDoc - commission : totalDoc;
      status = normaliseStatus(cell(row, iStatus));
      date = cell(row, iDate) || date;
      passengerName = cell(row, iPassenger);
      source = defaultSource || format;
      reqNum = cell(row, iReq) || extractReqNum(rowText, pnr);

      // fallback: if no ticket found, try regex
      if (!ticketNo) {
        const m = rowText.match(/\b\d{10,15}\b/);
        if (m) ticketNo = m[0];
      }

    } else {
      /* ══ REGEX FALLBACK ══ */
      const ticketMatch = row.find((c: string) => /^\d{10,15}$/.test(c?.trim()));
      ticketNo = ticketMatch?.trim() || rowText.match(/\b\d{10,15}\b/)?.[0] || '';

      const pnrCell = row.find((c: string) => isValidPNR(c?.trim()));
      pnr = pnrCell?.trim().toUpperCase() ||
        (() => {
          const m = rowText.match(/\b[A-Z0-9]{5,6}\b/i);
          return m && /[A-Z]/i.test(m[0]) ? m[0].toUpperCase() : '';
        })();

      const sm = rowText.match(/\b(TKTT|ISSU|VOID|REF|RFND|CANN|CANX|CNJ|EMDS)\b/i);
      if (sm) status = normaliseStatus(sm[1]);

      if (ticketNo) {
        const possibleAmounts = row
          .map((c: string) => parseFloat(c?.replace(/,/g, '')?.trim()))
          .filter((n: number) => !isNaN(n) && n !== 0 && Math.abs(n) < 1_000_000 && n.toString() !== ticketNo);
        amount = possibleAmounts[0] ?? 0;
      }

      if (!defaultSource) {
        const tl = rowText.toLowerCase();
        if (tl.includes('flyadeal ksa')) source = 'FlyAdeal KSA';
        else if (tl.includes('flyadeal dxb')) source = 'FlyAdeal DXB';
        else if (tl.includes('flyadeal')) source = 'FlyAdeal KSA';
        else if (tl.includes('flynas')) source = 'Flynas';
        else if (tl.includes('flydubai')) source = 'FlyDubai';
        else if (tl.includes('air arabia') || tl.includes('airarabia')) source = 'AirArabia';
        else if (tl.includes('ibtekar')) source = 'Ibtekar';
        else if (tl.includes('gold medal') || tl.includes('goldmedal')) source = 'Gold Medal';
        else if (tl.includes('rts')) source = 'RTS';
        else if (tl.includes('iata')) source = 'IATA';
      } else {
        source = defaultSource;
      }

      reqNum = extractReqNum(rowText, pnr);
      totalDoc = amount;
    }

    /* ── apply status → amount logic ── */
    amount = applyStatusAmountLogic(amount, status);
    if (totalDoc === 0) totalDoc = Math.abs(amount) + commission;

    /* ── validate and push ── */
    const isLCC = format === 'FLYADEAL';
    const validTicket = isLCC
      ? isValidPNR(ticketNo)
      : /^\d{10,15}$/.test(ticketNo);

    if (validTicket) {
      if (!reqNum) {
        errors.push(`Ticket ${ticketNo}: Missing Req Num — please review.`);
      }
      if (!pnr) {
        errors.push(`Ticket ${ticketNo}: Missing PNR.`);
      }
      tickets.push({
        id: uuidv4(),
        ticketNo,
        pnr,
        passengerName,
        source: source.substring(0, 30),
        date,
        amount,
        commission,
        totalDoc,
        reqNum,
        status,
        userId: 'temp',
      });
    } else {
      if (row.some(c => c?.trim())) {
        errors.push(`Row ${rowNumber}: Could not detect valid Ticket No or PNR. (raw: ${rowText.substring(0, 60)})`);
      }
    }
  });

  return { tickets, errors };
}

/* ─────────────────────────────────────────────
   DUPLICATE DETECTION
───────────────────────────────────────────── */
export function detectDuplicates(tickets: Ticket[]): Ticket[] {
  const seen = new Set<string>();
  return tickets.map(t => {
    const key = t.ticketNo.trim();
    if (key && seen.has(key)) return { ...t, isDuplicate: true };
    if (key) seen.add(key);
    return { ...t, isDuplicate: false };
  });
}

/* ─────────────────────────────────────────────
   DETECT DUPLICATES AGAINST EXISTING DB
───────────────────────────────────────────── */
export function detectDuplicatesAgainstExisting(
  newTickets: Ticket[],
  existingTickets: Ticket[]
): { fresh: Ticket[]; updates: Ticket[]; duplicates: Ticket[] } {
  const existingMap = new Map(existingTickets.map(t => [t.ticketNo, t]));
  const fresh: Ticket[] = [];
  const updates: Ticket[] = [];
  const duplicates: Ticket[] = [];

  newTickets.forEach(t => {
    const existing = existingMap.get(t.ticketNo);
    if (!existing) {
      fresh.push(t);
    } else if (!existing.reqNum && t.reqNum) {
      // existing ticket missing req num — this is an update
      updates.push({ ...t, id: existing.id });
    } else {
      duplicates.push({ ...t, isDuplicate: true });
    }
  });

  return { fresh, updates, duplicates };
}
