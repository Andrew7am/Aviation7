import { v4 as uuidv4 } from 'uuid';
import { Ticket } from '../types';
import Papa from 'papaparse';

/* ─────────────────────────────────────────────
   STATUS NORMALISATION
───────────────────────────────────────────── */
function normaliseStatus(raw: string): string {
  const s = (raw || '').trim().toUpperCase();
  const MAP: Record<string, string> = {
    'TKTT': 'TKTT', 'ISSU': 'TKTT', 'ISSUE': 'TKTT', 'TICKETED': 'TKTT',
    'CONFIRMED': 'TKTT', 'CLOSED': 'TKTT',
    'VOID': 'VOID',
    'REF': 'RFND', 'RFND': 'RFND', 'REFUND': 'RFND',
    'CANN': 'CANN', 'CANX': 'CANN', 'CANCEL': 'CANN', 'CANCELLED': 'CANN',
    'CNJ': 'CNJ',
    'EMDS': 'EMDS', 'EMDA': 'EMDS',
    'ADMA': 'TKTT', 'ACMA': 'RFND',
  };
  return MAP[s] ?? s;
}

function applyStatusAmountLogic(amount: number, status: string): number {
  const s = status.toUpperCase();
  if (s === 'CANN') return 0;
  if (s === 'RFND' || s === 'VOID') return -Math.abs(amount);
  return amount;
}

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
function colIdx(headers: string[], ...needles: string[]): number {
  for (const needle of needles) {
    const idx = headers.findIndex(h => h.toLowerCase().trim() === needle.toLowerCase().trim());
    if (idx !== -1) return idx;
  }
  for (const needle of needles) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(needle.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cell(row: string[], idx: number): string {
  return idx >= 0 && idx < row.length ? (row[idx] ?? '').trim() : '';
}

function parseNum(raw: string): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/,/g, '').replace(/"/g, '').trim());
  return isNaN(n) ? 0 : n;
}

function isValidPNR(s: string): boolean {
  // Accept any 5-6 alphanumeric chars (letters only like FHLQGE, or mixed like ZB3KO9)
  // Must have at least one letter (exclude pure number sequences)
  return /^[A-Z0-9]{5,6}$/i.test(s) && /[A-Z]/i.test(s);
}

function extractAirlineCode(ticketNo: string): string {
  const m1 = ticketNo.match(/^(\d{3})\s*[-–]\s*\d+/);
  if (m1) return m1[1];
  const m2 = ticketNo.match(/^(\d{3})\d{7,}/);
  if (m2) return m2[1];
  return '';
}

function cleanTicketNo(raw: string): string {
  const m = raw.match(/^(\d{3})\s*[-–]\s*(\d+)$/);
  if (m) return m[1] + m[2];
  return raw.replace(/\s+/g, '');
}

function cleanPassengerName(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().replace(/^(MR\.?|MRS\.?|MS\.?|DR\.?|MISS\.?|INF\.?|CHD\.?|MR |MRS |MS )\s*/i, '');
  if (s.includes('/')) {
    const parts = s.split('/');
    s = ((parts[1] || '') + ' ' + (parts[0] || '')).trim();
  }
  // "LASTNAME, FIRSTNAME" → "FIRSTNAME LASTNAME"
  if (s.includes(',')) {
    const parts = s.split(',');
    s = ((parts[1] || '') + ' ' + (parts[0] || '')).trim();
  }
  return s.replace(/\s+/g, ' ').toUpperCase().replace(/\/.*$/, '').trim();
}

/* ─────────────────────────────────────────────
   REQ NUM — accept any LETTERS+DIGITS pattern
   Covers: SA1109, KSAML1928, UAEVP411, REQ11441, KSACO363, etc.
   Strips spaces: "SA 1109" → "SA1109"
───────────────────────────────────────────── */
function cleanReqNum(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.replace(/\s+/g, '').toUpperCase();
  // Reject known non-req values
  if (['NEEDREQ', 'ADM', '0', 'MISSING', 'PAYMENT', 'FUND', 'TOPUP'].includes(cleaned)) return '';
  if (/^(RV|INV|RFD)\d+/i.test(cleaned)) return ''; // internal doc refs
  // Must be letters then digits (or mixed like REQ11441)
  if (/^[A-Z]{1,8}\d{1,6}$/i.test(cleaned)) return cleaned;
  // Handle "REQ 11441" → "REQ11441" (already cleaned above)
  if (/^[A-Z]{2,8}\d{3,6}$/i.test(cleaned)) return cleaned;
  return '';
}

/* ─────────────────────────────────────────────
   FORMAT DETECTION
───────────────────────────────────────────── */
type ParseFormat =
  | 'CUSTOM_IATA'    // our internal IATA sheet: Serial, Airline key, ticket number, total, NET, PNR, Service, Req Number
  | 'BSP_IATA'       // BSP IATA: SEQ NO, TRNC, DOC NUMBER, TOTAL DOC, COMM, RLOC
  | 'NSA'            // NSA: DATE, LPO NUMBER, Request Number, Doc No, Description, PNR, DEBIT, Credit
  | 'FLYADEAL_DXB'   // FlyAdeal DXB: paymentDate, pnr, accountAmount, passenger_Name, Req number
  | 'FLYADEAL_KSA'   // FlyAdeal KSA: recordLocator, passengerName, legDetails, pnrTotal, Req Number
  | 'IBTEKAR'        // Ibtekar: Date, File No, Doc No, Ticket, PNR, Issue Date, Passenger, Sector, Debit, Credit
  | 'GOLDMEDAL'      // Gold Medal: Customer No, Name, Invoice Number, Passenger Name, PO Number, Ticket Number, Routing
  | 'RTS'            // RTS: PNR creation date, Record Locator, Passenger, No, Action, Total
  | 'AIRARABIA'      // Air Arabia: Reference Code, Transaction date, Debit Amount, Ticket Number, Request Number
  | 'FLYNAS'         // FlyNas: Date, PNR2, pax, AMOUNT, REQ. NUMBER, Status
  | 'FLYDUBAI'       // FlyDubai: Invoice no., Payment date, Booking reference, Passenger name, Amount, REQ Number
  | 'EXPORT'         // our own export format
  | 'REGEX';

function detectFormat(headers: string[], defaultSource?: string): ParseFormat {
  const h  = headers.map(c => (c || '').trim().toLowerCase());
  const hj = h.join('|');

  if (h.includes('ticket no.') && h.includes('req num')) return 'EXPORT';

  // BSP IATA
  if (h.includes('seq no') && h.includes('trnc') && h.includes('doc number')) return 'BSP_IATA';

  // Our internal IATA sheet: "ticket number" + "net" + "req number"
  if (hj.includes('ticket number') && hj.includes('pax name') && hj.includes('req number')) return 'CUSTOM_IATA';
  if (hj.includes('airline key') && hj.includes('ticket number')) return 'CUSTOM_IATA';

  // NSA: has "lpo number" + "request number" + "doc no" + "debit"
  if (hj.includes('lpo number') && hj.includes('request number') && hj.includes('doc no')) return 'NSA';

  // FlyAdeal DXB: paymentdate + pnr + accountamount
  if (h.includes('paymentdate') && h.includes('pnr') && (hj.includes('accountamount') || hj.includes('bookingamount'))) return 'FLYADEAL_DXB';

  // FlyAdeal KSA: recordLocator + legDetails + pnrTotal
  if (hj.includes('recordlocator') && hj.includes('legdetails') && hj.includes('pnrtotal')) return 'FLYADEAL_KSA';
  if (hj.includes('recordlocator') && hj.includes('passengername') && hj.includes('pnrtotal')) return 'FLYADEAL_KSA';

  // Ibtekar: File No + Ticket + Debit + Credit + Sector
  if (hj.includes('file no') && h.includes('ticket') && h.includes('debit') && h.includes('sector')) return 'IBTEKAR';

  // Gold Medal: Customer No + Transaction_Type + Routing + Ticket Number
  if (hj.includes('customer no') && hj.includes('transaction_type') && hj.includes('routing')) return 'GOLDMEDAL';
  if (hj.includes('customer no') && hj.includes('ticket number') && hj.includes('passenger name')) return 'GOLDMEDAL';

  // Air Arabia: Reference Code + Debit Amount + Ticket Number + Request Number
  if (hj.includes('reference code') && hj.includes('debit amount') && hj.includes('ticket number')) return 'AIRARABIA';

  // FlyNas: PNR2 + pax + AMOUNT + REQ. NUMBER
  if (hj.includes('pnr2') && hj.includes('req. number')) return 'FLYNAS';
  if (hj.includes('pnr2') && h.includes('pax')) return 'FLYNAS';

  // FlyDubai: Invoice no. + Booking reference + Passenger name + REQ Number
  if (hj.includes('invoice no') && hj.includes('booking reference')) return 'FLYDUBAI';
  if (hj.includes('invoice no') && hj.includes('passenger name') && hj.includes('req number')) return 'FLYDUBAI';

  // RTS: Record Locator + Action + Total + No (ticket)
  if (h.includes('record locator') && h.includes('action')) return 'RTS';
  if (hj.includes('record locator') && h.includes('no') && h.includes('passenger')) return 'RTS';

  // defaultSource override
  if (defaultSource) {
    const ds = defaultSource.toUpperCase().replace(/\s+/g, '');
    if (ds === 'IATA') return 'CUSTOM_IATA';
    if (ds === 'NSA') return 'NSA';
    if (ds.includes('FLYADEAL') && ds.includes('KSA')) return 'FLYADEAL_KSA';
    if (ds.includes('FLYADEAL') && ds.includes('DXB')) return 'FLYADEAL_DXB';
    if (ds.includes('FLYADEAL')) return 'FLYADEAL_DXB';
    if (ds === 'IBTEKAR') return 'IBTEKAR';
    if (ds.includes('GOLD')) return 'GOLDMEDAL';
    if (ds === 'RTS' || ds.includes('RTSDXB')) return 'RTS';
    if (ds.includes('AIRARABIA') || ds === 'AIRARABIA') return 'AIRARABIA';
    if (ds === 'FLYNAS') return 'FLYNAS';
    if (ds.includes('FLYDUBAI')) return 'FLYDUBAI';
  }

  return 'REGEX';
}

/* ═══════════════════════════════════════════════
   MAIN PARSE FUNCTION
═══════════════════════════════════════════════ */
export function parseManualInput(
  text: string,
  defaultSource?: string
): { tickets: Ticket[]; errors: string[] } {
  const tickets: Ticket[] = [];
  const errors:  string[] = [];

  const result = Papa.parse(text.trim(), { skipEmptyLines: true });
  if (!result.data.length) return { tickets, errors };
  const allRows = result.data as string[][];

  /* ── Find header row (skip meta rows at top) ── */
  const HEADER_SIGNALS = [
    'ticket number', 'doc number', 'seq no', 'paymentdate', 'recordlocator',
    'record locator', 'lpo number', 'customer no', 'reference code',
    'pnr2', 'invoice no', 'file no', 'debit', 'pnr',
  ];
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(allRows.length, 15); i++) {
    const rowLower = allRows[i].map(c => (c || '').toLowerCase().replace(/\s+/g, '')).join('|');
    if (HEADER_SIGNALS.some(sig => rowLower.includes(sig.replace(/\s+/g, '')))) {
      headerRowIdx = i;
      break;
    }
  }

  const headerRow = allRows[headerRowIdx];
  const dataRows  = allRows.slice(headerRowIdx + 1);
  const format    = detectFormat(headerRow, defaultSource);
  const h         = headerRow.map(c => (c || '').trim());

  /* ── Column indices per format ── */
  let iTicket = -1, iPNR = -1, iAmount = -1, iComm = -1, iTotalDoc = -1;
  let iStatus = -1, iDate = -1, iPassenger = -1, iReq = -1, iAirline = -1, iRoute = -1;

  if (format === 'EXPORT') {
    iTicket    = colIdx(h, 'Ticket No.');
    iReq       = colIdx(h, 'Req Num');
    iPNR       = colIdx(h, 'PNR');
    iAmount    = colIdx(h, 'Amount');
    iStatus    = colIdx(h, 'Status');
    iDate      = colIdx(h, 'Date');
    iPassenger = colIdx(h, 'Passenger', 'Pax', 'Name');
    iComm      = colIdx(h, 'Commission', 'Comm');
    iTotalDoc  = colIdx(h, 'Total Doc', 'Total');

  } else if (format === 'CUSTOM_IATA') {
    // Serial | Airline key | ticket number | total | tax | comm | NET | Pax Name | PNR | Service | Req Number
    iAirline   = colIdx(h, 'Airline key');
    iTicket    = colIdx(h, 'ticket number', 'Ticket number');
    iTotalDoc  = colIdx(h, 'total', 'Total');
    iComm      = colIdx(h, 'comm', 'Comm');
    iAmount    = colIdx(h, 'NET', 'Net');
    iPassenger = colIdx(h, 'Pax Name', 'PAX NAME', 'Passenger');
    iPNR       = colIdx(h, 'PNR');
    iStatus    = colIdx(h, 'Service');
    iReq       = colIdx(h, 'Req Number', 'Req number', 'REQ NUMBER');

  } else if (format === 'BSP_IATA') {
    iAirline   = colIdx(h, 'A/L', 'AIRLINE', 'AL');
    iTicket    = colIdx(h, 'DOC NUMBER', 'DOCNUMBER');
    iTotalDoc  = colIdx(h, 'TOTAL DOC', 'TOTALDOC');
    iComm      = colIdx(h, 'COMM');
    iPassenger = colIdx(h, 'PAX NAME', 'PAXNAME', 'PASSENGER');
    iPNR       = colIdx(h, 'RLOC');
    iStatus    = colIdx(h, 'TRNC');
    iDate      = colIdx(h, 'DATE', 'TRAVEL DATE', 'ISSUE DATE', 'DEP DATE');
    iReq       = colIdx(h, 'Req Number', 'REQ NUMBER', 'REQ NUM');

  } else if (format === 'NSA') {
    // DATE | notes | EVENT MONTH | LPO NUMBER | Operator name | Request Number | Doc No | Description | PNR | DEBIT | Credit | Outstanding
    iDate      = colIdx(h, 'DATE');
    iReq       = colIdx(h, 'Request Number');
    iTicket    = colIdx(h, 'Doc No');          // "157 - 2899436427"
    iPassenger = colIdx(h, 'Description');     // passenger name in Description
    iPNR       = colIdx(h, 'PNR');
    iAmount    = colIdx(h, 'DEBIT', 'DEBIT (SAR)');
    iRoute     = colIdx(h, 'LPO NUMBER');      // LPO NUMBER col has "International"/"domestic"
    // Credit col = iAmount + 1

  } else if (format === 'FLYADEAL_DXB') {
    // paymentDate | pnr | parentOrg | org | type | passenger_Name | ... | bookingAmount | bookingCurrency | accountAmount | accountCurrency | Balance | ...
    iPNR       = colIdx(h, 'pnr');
    iDate      = colIdx(h, 'paymentDate', 'paymentdate');
    iPassenger = colIdx(h, 'passenger_Name', 'passenger_name', 'passenger');
    iAmount    = colIdx(h, 'accountAmount', 'accountamount', 'bookingAmount', 'bookingamount');
    iStatus    = colIdx(h, 'Status', 'status', 'type');
    // DXB may not have Req Number column — will be MISSING
    iReq       = colIdx(h, 'Req number', 'Req Number', 'REQ NUMBER', 'req');

  } else if (format === 'FLYADEAL_KSA') {
    // createdUserCode | organizationCode | ... | recordLocator | ... | passengerName | ... | legDetails | pnrTotal | ... | status | ... | Req Number
    iPNR       = colIdx(h, 'recordLocator', 'recordlocator');
    iPassenger = colIdx(h, 'passengerName', 'passengername');
    iAmount    = colIdx(h, 'pnrTotal', 'pnrtotal', 'totalInOrgCurrency', 'totalinorgcurrency');
    iDate      = colIdx(h, 'departureDate', 'departuredate');
    iStatus    = colIdx(h, 'status');
    iRoute     = colIdx(h, 'legDetails', 'legdetails');  // "RUH-JED" = domestic, "RUH-DXB" = international
    iReq       = colIdx(h, 'Req Number', 'Req number', 'REQ NUMBER');

  } else if (format === 'IBTEKAR') {
    // Date(0) File No(1) Doc No(2) Ticket(3) PNR(4) Issue Date(5) LPO No(6) Passenger(7) Sector(8) Debit(9) Credit(10) Balance(11)
    iReq       = colIdx(h, 'File No', 'FileNo');      // File No = OUR Req Num
    iTicket    = colIdx(h, 'Ticket');
    iPNR       = colIdx(h, 'PNR');
    iDate      = colIdx(h, 'Issue Date');
    iPassenger = colIdx(h, 'Passenger');
    iAmount    = colIdx(h, 'Debit');                  // col 9
    iRoute     = colIdx(h, 'Sector');                 // route: "RUH/MED", "MED/DMM"
    // Credit = iAmount + 1

  } else if (format === 'GOLDMEDAL') {
    // Customer No(0) | Name(1) | Transaction_Type(2) | Invoice Number(3) | Invoice Date(4) | REQ_COL(5=UAECO438) | Passenger Name(6) | PO Number(7=BKR-xxx, skip) | Curr(8) | Original Amount(9) | Balance Due(10) | Status(11) | Routing(12) | Ticket Number(13)
    iDate      = colIdx(h, 'Invoice Date');
    iTicket    = colIdx(h, 'Ticket Number', 'ticket number');
    iPassenger = colIdx(h, 'Passenger Name', 'passenger name');
    iAmount    = colIdx(h, 'Original Amount');
    iStatus    = colIdx(h, 'Transaction_Type', 'transaction_type', 'Status');
    iRoute     = colIdx(h, 'Routing');
    iReq       = 5;  // Col 5 contains the real req num (e.g. UAECO438) — NOT PO Number (BKR-xxx)

  } else if (format === 'AIRARABIA') {
    // Reference Code | Transaction date | Debit Amount | Credit Amount | balance | Remarks(PNR) | Ticket Number | Customer name | User ID | Request Number | Status
    iDate      = colIdx(h, 'Transaction date', 'Transaction Date');
    iPNR       = colIdx(h, 'Remarks');
    iTicket    = colIdx(h, 'Ticket Number', 'ticket number');
    iPassenger = colIdx(h, 'Custmoner name', 'Customer name', 'customer name');
    iAmount    = colIdx(h, 'Debit Amount', 'debit amount');
    iStatus    = colIdx(h, 'Status', 'status');
    iReq       = colIdx(h, 'Request Number');

  } else if (format === 'FLYNAS') {
    // Date | PNR2 | pax | AMOUNT | REQ. NUMBER | balance | Column6(route) | Status
    iDate      = colIdx(h, 'Date');
    iPNR       = colIdx(h, 'PNR2');
    iPassenger = colIdx(h, 'pax');
    iAmount    = colIdx(h, 'AMOUNT');
    iReq       = colIdx(h, 'REQ. NUMBER', 'REQ NUMBER', 'Req Number');
    iRoute     = colIdx(h, 'Column6', 'Route');        // "domestic" / "international"
    iStatus    = colIdx(h, 'Status');

  } else if (format === 'FLYDUBAI') {
    // Invoice no. | Payment date | Booking reference | ... | Amount | ... | Passenger name | Departure date | ... | REQ Number | Status
    iDate      = colIdx(h, 'Payment date', 'payment date', 'Booked date', 'booked date');
    iPNR       = colIdx(h, 'Booking reference', 'booking reference');
    iPassenger = colIdx(h, 'Passenger name', 'passenger name');
    iAmount    = colIdx(h, 'Amount');
    iStatus    = colIdx(h, 'Status', 'Remarks');
    iReq       = colIdx(h, 'REQ Number', 'Req Number', 'REQ NUMBER');

  } else if (format === 'RTS') {
    // PNR creation date(0) | Record Locator(1) | Passenger(2) | No/ticket(3) | REQ(4) | Action(5) | Total(6) | Total currency(7)
    iDate      = colIdx(h, 'PNR creation date');  // col 0
    iPNR       = colIdx(h, 'Record Locator');      // col 1
    iPassenger = colIdx(h, 'Passenger');           // col 2
    iTicket    = colIdx(h, 'No');                  // col 3: "220-5512605725"
    iReq       = 4;                                // col 4: always req num (ksaco379, uaevp411 etc.)
    iStatus    = colIdx(h, 'Action');              // col 5
    iAmount    = colIdx(h, 'Total');               // col 6
    iAirline   = -1;
  }

  /* ══ PROCESS ROWS ══ */
  dataRows.forEach((row: string[], index: number) => {
    if (!Array.isArray(row) || row.every(c => !c?.trim())) return;

    const rowText   = row.join(' ');
    const rowNumber = headerRowIdx + index + 2;

    let ticketNo      = '';
    let pnr           = '';
    let amount        = 0;
    let commission    = 0;
    let totalDoc      = 0;
    let status        = '';
    let date          = new Date().toISOString().split('T')[0];
    let source        = defaultSource || '';
    let reqNum        = '';
    let passengerName = '';
    let airlineCode   = '';
    let route         = '';

    /* ════════════════ PER-FORMAT PARSING ════════════════ */

    if (format === 'EXPORT') {
      ticketNo      = cell(row, iTicket);
      reqNum        = cleanReqNum(cell(row, iReq));
      pnr           = cell(row, iPNR);
      source        = defaultSource || '';
      status        = normaliseStatus(cell(row, iStatus));
      date          = cell(row, iDate) || date;
      passengerName = cleanPassengerName(cell(row, iPassenger));
      commission    = parseNum(cell(row, iComm));
      totalDoc      = parseNum(cell(row, iTotalDoc));
      amount        = totalDoc > 0 ? totalDoc - commission : parseNum(cell(row, iAmount));
      airlineCode   = extractAirlineCode(ticketNo);

    } else if (format === 'CUSTOM_IATA') {
      // Our internal IATA format
      ticketNo      = cell(row, iTicket).replace(/\s+/g, '');
      if (!/^\d{8,15}$/.test(ticketNo)) return;

      airlineCode   = cell(row, iAirline) || extractAirlineCode(ticketNo);
      pnr           = cell(row, iPNR).trim().toUpperCase();
      totalDoc      = parseNum(cell(row, iTotalDoc));
      commission    = parseNum(cell(row, iComm));
      // NET col has the final amount
      const netVal  = parseNum(cell(row, iAmount));
      amount        = netVal || (totalDoc - commission);
      // Negative amount = refund/credit note
      if (amount < 0) status = 'RFND';
      else {
        const svcRaw = cell(row, iStatus).toUpperCase();
        status = svcRaw === 'EMDS' || svcRaw === 'EMDA' ? 'EMDS' : 'TKTT';
      }
      passengerName = cleanPassengerName(cell(row, iPassenger));
      source        = defaultSource || 'IATA';
      // Req Num: read from column, clean spaces "SA 1109" → "SA1109"
      const reqRaw  = cell(row, iReq);
      reqNum        = cleanReqNum(reqRaw);

    } else if (format === 'BSP_IATA') {
      ticketNo      = cell(row, iTicket).replace(/\s+/g, '');
      const alVal   = iAirline >= 0 ? cell(row, iAirline) : '';
      airlineCode   = /^\d{3}$/.test(alVal) ? alVal : extractAirlineCode(ticketNo);
      pnr           = cell(row, iPNR);
      totalDoc      = parseNum(cell(row, iTotalDoc));
      commission    = parseNum(cell(row, iComm));
      amount        = totalDoc - commission;
      status        = normaliseStatus(cell(row, iStatus));
      passengerName = cleanPassengerName(cell(row, iPassenger));
      source        = defaultSource || 'IATA';
      const bspReq  = cell(row, iReq);
      reqNum        = cleanReqNum(bspReq);
      if (iDate >= 0) {
        const rd = cell(row, iDate);
        if (rd && /\d{4}/.test(rd)) date = rd;
      }

    } else if (format === 'NSA') {
      // Doc No = "157 - 2899436427" → ticketNo
      const rawDocNo = cell(row, iTicket);

      // Skip payment rows: Doc No starts with "RV-" or "Payment" in description
      const descVal = cell(row, iPassenger);
      const isPayment = /^RV-/i.test(rawDocNo) || /^payment/i.test(descVal);
      if (isPayment) {
        // Check if it's a credit/top-up (Credit col > 0)
        const creditAmt = parseNum(cell(row, iAmount + 1));
        if (creditAmt > 0) {
          const rawDateNSA = cell(row, iDate);
          const excelDate = parseInt(rawDateNSA);
          const nsaDate = !isNaN(excelDate)
            ? new Date((excelDate - 25569) * 86400000).toISOString().split('T')[0]
            : rawDateNSA;
          tickets.push({
            id: uuidv4(), ticketNo: rawDocNo, pnr: '',
            passengerName: 'BALANCE TOP-UP', airlineCode: '',
            source: defaultSource || 'NSA', date: nsaDate,
            amount: creditAmt, commission: 0, totalDoc: creditAmt,
            reqNum: '', status: 'TOPUP', userId: 'temp',
          });
        }
        return;
      }

      // Valid ticket: Doc No = "XXX - NNNNNNNNNN"
      if (!rawDocNo.includes(' - ') && !/^\d{3}[-]\d+$/.test(rawDocNo.replace(/\s/g, ''))) return;

      ticketNo    = cleanTicketNo(rawDocNo);
      airlineCode = extractAirlineCode(rawDocNo);
      pnr         = cell(row, iPNR).toUpperCase();
      passengerName = cleanPassengerName(descVal);

      const nsaDebit  = parseNum(cell(row, iAmount));
      const nsaCredit = parseNum(cell(row, iAmount + 1));
      if (nsaCredit > 0 && nsaDebit === 0) {
        amount = -nsaCredit;
        status = 'RFND';
      } else {
        amount = nsaDebit;
        status = 'TKTT';
      }
      totalDoc = Math.abs(amount);

      // Route from LPO NUMBER col: "International", "domestic", "Domestic"
      route = cell(row, iRoute);

      // Date: "2-Jun-25" → "2025-06-02" or Excel serial
      const rawDateNSA = cell(row, iDate).trim();
      const nsaSerial  = parseInt(rawDateNSA);
      if (!isNaN(nsaSerial) && nsaSerial > 40000) {
        date = new Date((nsaSerial - 25569) * 86400000).toISOString().split('T')[0];
      } else if (rawDateNSA) {
        const parsed = new Date(rawDateNSA);
        date = isNaN(parsed.getTime()) ? rawDateNSA : parsed.toISOString().split('T')[0];
      }

      source = defaultSource || 'NSA';
      reqNum = cleanReqNum(cell(row, iReq));

    } else if (format === 'FLYADEAL_DXB') {
      pnr = cell(row, iPNR).toUpperCase();
      if (!pnr || pnr.length < 5) return;

      // accountCurrency col = 11: if SAR → this is a top-up/internal transfer, skip as ticket
      const acctCurrency = cell(row, 11).toUpperCase(); // accountCurrency col
      if (acctCurrency === 'SAR') {
        // Could be a top-up — check bookingAmount (col 8) for negative = refund to us
        const bookAmt = parseNum(cell(row, 8));
        if (bookAmt < 0) {
          // Negative booking = refund credited back
          return; // skip, handled at vendor level
        }
        return; // SAR rows = internal, not AED tickets
      }

      // Use accountAmount (col 10) = AED equivalent
      const acctAmt = parseNum(cell(row, iAmount)); // col 10
      if (acctAmt === 0) return;

      ticketNo      = pnr;
      amount        = acctAmt < 0 ? acctAmt : acctAmt; // negative = refund
      totalDoc      = Math.abs(amount);
      status        = amount < 0 ? 'RFND' : 'TKTT';
      const rawDateDXB = cell(row, iDate);
      date          = rawDateDXB ? rawDateDXB.split('T')[0] : date;
      passengerName = cleanPassengerName(cell(row, iPassenger));
      source        = defaultSource || 'FlyAdeal DXB';
      reqNum        = cleanReqNum(cell(row, iReq));

    } else if (format === 'FLYADEAL_KSA') {
      pnr           = cell(row, iPNR).trim().toUpperCase();
      ticketNo      = pnr;
      if (!pnr || pnr.length < 5) return;
      amount        = parseNum(cell(row, iAmount));
      if (amount === 0) return;
      totalDoc      = Math.abs(amount);
      status        = normaliseStatus(cell(row, iStatus));
      if (!status) status = amount < 0 ? 'RFND' : 'TKTT';
      const rawDateKSA = cell(row, iDate);
      date          = rawDateKSA ? rawDateKSA.split('T')[0] : date;
      passengerName = cleanPassengerName(cell(row, iPassenger));
      // Route from legDetails: "RUH-JED" (domestic), "RUH-DXB" (international)
      route         = cell(row, iRoute);
      source        = defaultSource || 'FlyAdeal KSA';
      reqNum        = cleanReqNum(cell(row, iReq));

    } else if (format === 'IBTEKAR') {
      const rawTicketIbk = cell(row, iTicket);
      const fileNo       = cell(row, iReq);   // File No = our Req Num

      // TopUp / Fund: File No = "TopUP"/"fund" OR Ticket = "RVxxxxxxx"
      const isTopUp = /^(topup|fund|top.?up)$/i.test(fileNo)
        || /^RV\d+$/i.test(rawTicketIbk);
      if (isTopUp) {
        const depositAmt = parseNum(cell(row, iAmount + 1));
        if (depositAmt > 0) {
          const rawDtUp = cell(row, 0);
          const dpUp = (rawDtUp || '').split('/');
          const dtUp = dpUp.length === 3 ? `${dpUp[2]}-${dpUp[1]}-${dpUp[0]}` : rawDtUp || date;
          tickets.push({
            id: uuidv4(), ticketNo: rawTicketIbk, pnr: '',
            passengerName: 'BALANCE TOP-UP', airlineCode: '',
            source: defaultSource || 'Ibtekar', date: dtUp,
            amount: depositAmt, commission: 0, totalDoc: depositAmt,
            reqNum: cleanReqNum(fileNo), status: 'TOPUP', userId: 'temp',
          });
        }
        return;
      }

      // Valid ticket: "XXX - NNNNNNNNNN"
      const hasIbkTk = rawTicketIbk.includes(' - ') || /^\d{10,}$/.test(rawTicketIbk.replace(/\s/g, ''));
      if (!hasIbkTk) return;

      ticketNo      = cleanTicketNo(rawTicketIbk);
      airlineCode   = extractAirlineCode(rawTicketIbk);
      pnr           = cell(row, iPNR).toUpperCase();
      passengerName = cleanPassengerName(cell(row, iPassenger));
      route         = cell(row, iRoute);   // Sector: "RUH/MED", "MED/DMM", "AHB/JED/MED/JED/AHB"

      const ibkDebit  = parseNum(cell(row, iAmount));
      const ibkCredit = parseNum(cell(row, iAmount + 1));
      // RFD doc = refund
      const ibkDocNo  = cell(row, colIdx(h, 'Doc No'));
      const isIbkRef  = /^RFD/i.test(ibkDocNo) || (ibkCredit > 0 && ibkDebit === 0);
      if (isIbkRef) {
        amount = -Math.abs(ibkCredit > 0 ? ibkCredit : ibkDebit);
        status = 'RFND';
      } else {
        amount = ibkDebit;
        status = 'TKTT';
      }
      totalDoc   = Math.abs(amount);
      commission = 0;

      const rawDtIbk = cell(row, iDate);
      if (rawDtIbk) {
        const p = rawDtIbk.split('/');
        date = p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : rawDtIbk;
      }

      source = defaultSource || 'Ibtekar';
      // File No IS our Req Num. "NEED REQ" or blank = missing
      reqNum = cleanReqNum(fileNo);

    } else if (format === 'GOLDMEDAL') {
      // Gold Medal has 2 row types:
      // Type A (INV rows): col13=Ticket "4815040418(1 PAX)", col5="Dubai" (not req), col12=Routing
      // Type B (no-invoice rows): col13 empty, col5=req "UAECO438", col6=passenger, col9=amount
      const rawGMTicket = cell(row, iTicket).replace(/\s*\(\d+\s*PAX\)/i, '').replace(/,/g, '').trim();
      // col 5: "Dubai" in INV rows (NOT req), "UAECO438" in Type B rows (IS req)
      const gmCol5 = cell(row, 5).trim();
      const hasTicket = rawGMTicket && /\d{8,}/.test(rawGMTicket);
      // Only treat col5 as req if cleanReqNum accepts it (rejects "Dubai", "SAR", etc.)
      const hasReqInCol5 = cleanReqNum(gmCol5) !== '';

      if (!hasTicket && !hasReqInCol5) return; // skip empty/total rows

      passengerName = cleanPassengerName(cell(row, iPassenger));
      amount        = parseNum(cell(row, iAmount));
      if (amount === 0) return;
      totalDoc      = Math.abs(amount);
      commission    = 0;
      route         = cell(row, iRoute);

      if (hasTicket) {
        // Type A: has ticket number, routing, date
        ticketNo = rawGMTicket.replace(/[^0-9]/g, '');
        const txType = cell(row, iStatus).toUpperCase();
        status = txType === 'CRN' || txType === 'CREDIT' ? 'RFND' : 'TKTT';
        const rawDateGM = cell(row, iDate);
        const gmSerial = parseInt(rawDateGM);
        if (!isNaN(gmSerial) && gmSerial > 40000) {
          date = new Date((gmSerial - 25569) * 86400000).toISOString().split('T')[0];
        } else if (rawDateGM) {
          date = rawDateGM;
        }
        // Type A rows don't have req in col5 — leave MISSING
        reqNum = ''; // Will show as MISSING, user can fill via re-import

      } else {
        // Type B: no ticket, but has req num in col5 and amount
        // Use a composite key: passenger initial + amount (no standard ticket number available)
        // Encode as "GM" + amount to make it identifiable
        ticketNo = 'GM' + Math.abs(amount).toFixed(0) + '_' + passengerName.replace(/\s+/g,'').substring(0,6);
        status = amount < 0 ? 'RFND' : 'TKTT';
        reqNum = hasReqInCol5 ? cleanReqNum(gmCol5) : '';
      }

      pnr         = ''; // Gold Medal has no PNR
      airlineCode = '';
      source      = defaultSource || 'Gold Medal';

    } else if (format === 'AIRARABIA') {
      // Reference Code | Transaction date | Debit Amount | Credit Amount | balance | Remarks(PNR) | Ticket Number | Customer name | User ID | Request Number
      ticketNo      = cell(row, iTicket).replace(/[^0-9]/g, '');
      pnr           = cell(row, iPNR).toUpperCase();
      passengerName = cleanPassengerName(cell(row, iPassenger));

      const arDebit  = parseNum(cell(row, iAmount));
      const arCredit = parseNum(cell(row, iAmount + 1));

      // Credit row = balance top-up (like "-20000" in debit = deposit)
      if (arDebit < 0 && arCredit === 0) {
        // negative debit = credit to account
        tickets.push({
          id: uuidv4(), ticketNo: cell(row, 0), pnr: '',
          passengerName: 'BALANCE TOP-UP', airlineCode: '',
          source: defaultSource || 'AirArabia', date,
          amount: Math.abs(arDebit), commission: 0, totalDoc: Math.abs(arDebit),
          reqNum: '', status: 'TOPUP', userId: 'temp',
        });
        return;
      }

      if (arCredit > 0 && arDebit === 0) {
        amount = -arCredit;
        status = 'RFND';
      } else {
        amount = arDebit;
        status = 'TKTT';
      }
      if (!ticketNo) return; // skip balance rows
      totalDoc = Math.abs(amount);

      // Date: Excel serial
      const arDateRaw = cell(row, iDate);
      const arSerial = parseInt(arDateRaw);
      if (!isNaN(arSerial) && arSerial > 40000) {
        date = new Date((arSerial - 25569) * 86400000).toISOString().split('T')[0];
      }

      airlineCode = extractAirlineCode(ticketNo);
      source = defaultSource || 'AirArabia';
      reqNum = cleanReqNum(cell(row, iReq));

    } else if (format === 'FLYNAS') {
      const nasPNRRaw = (cell(row, iPNR) || '').trim();
      pnr = nasPNRRaw.replace(/\s+/g, '').toUpperCase();
      const nasPax = cell(row, iPassenger);

      // Skip: Beg. Balance row (appears in PNR col or pax col), or empty/non-alpha PNR
      if (/beg\.?\s*balance/i.test(nasPNRRaw) || /beg\.?\s*balance/i.test(nasPax) || !pnr) return;
      // Skip if PNR col looks like a header or label (contains spaces in middle = not a PNR)
      if (pnr.includes(' ') || pnr.length < 5) return;

      // Fund/top-up row: pax says "Fund"
      if (/^fund$/i.test(nasPax.trim())) {
        // Amount in FlyNas is negative for top-up (they deduct from your balance display)
        const rawFundAmt = cell(row, iAmount).replace(/SAR|,|\s/gi, '');
        const fundAmt = Math.abs(parseFloat(rawFundAmt) || 0);
        if (fundAmt > 0) {
          tickets.push({
            id: uuidv4(), ticketNo: 'FUND', pnr: '',
            passengerName: 'BALANCE TOP-UP', airlineCode: '',
            source: defaultSource || 'Flynas', date,
            amount: fundAmt, commission: 0, totalDoc: fundAmt,
            reqNum: '', status: 'TOPUP', userId: 'temp',
          });
        }
        return;
      }

      if (!isValidPNR(pnr)) return;
      ticketNo = pnr;

      // Strip "SAR" prefix from amount: " SAR 429.00 " → 429.00
      const nasAmtRaw = cell(row, iAmount).replace(/SAR|,|\s/gi, '');
      amount   = parseFloat(nasAmtRaw) || 0;
      totalDoc = Math.abs(amount);
      status   = amount < 0 ? 'RFND' : 'TKTT';

      passengerName = cleanPassengerName(nasPax);
      route         = cell(row, iRoute).toLowerCase().trim(); // "domestic" / "international"

      // Date: "21-Sep" "14-Sep" — add current year
      const nasDateRaw = cell(row, iDate);
      const nasSerial  = parseInt(nasDateRaw);
      if (!isNaN(nasSerial) && nasSerial > 40000) {
        date = new Date((nasSerial - 25569) * 86400000).toISOString().split('T')[0];
      } else if (nasDateRaw) {
        // "21-Sep" → "21-Sep-2026", "9-Oct" → "9-Oct-2026"
        const withYear = /^\d{1,2}-[A-Za-z]{3}$/.test(nasDateRaw.trim())
          ? nasDateRaw.trim() + '-2026'
          : nasDateRaw.trim();
        const tryDate = new Date(withYear);
        date = isNaN(tryDate.getTime()) ? nasDateRaw : tryDate.toISOString().split('T')[0];
      }

      source = defaultSource || 'Flynas';
      // Req Num: "REQ 11160" → "REQ11160", "SA 883" → "SA883"
      reqNum = cleanReqNum(cell(row, iReq));

    } else if (format === 'FLYDUBAI') {
      // PNR = Booking reference (col 2): "UXSGHS", "UP049J"
      pnr = cell(row, iPNR).trim().toUpperCase();
      if (!pnr || pnr === 'NA' || pnr.length < 5) return;

      ticketNo      = pnr; // FlyDubai: PNR is the ticket identifier
      passengerName = cleanPassengerName(cell(row, iPassenger));
      amount        = parseNum(cell(row, iAmount));
      if (amount === 0) return; // skip balance rows

      totalDoc = Math.abs(amount);
      status   = amount < 0 ? 'RFND' : 'TKTT';

      // Date: Excel serial (e.g. 46057 → 2026-01-16)
      const fdDateRaw = cell(row, iDate);
      const fdSerial  = parseInt(fdDateRaw);
      if (!isNaN(fdSerial) && fdSerial > 40000) {
        date = new Date((fdSerial - 25569) * 86400000).toISOString().split('T')[0];
      } else if (fdDateRaw && fdDateRaw !== 'NA') {
        date = fdDateRaw;
      }

      source = defaultSource || 'FlyDubai';
      reqNum = cleanReqNum(cell(row, iReq));

    } else if (format === 'RTS') {
      // No col (3): "220-5512605725" → ticket "2205512605725", airline "220"
      const rawRTSTk = cell(row, iTicket);
      if (!rawRTSTk || !rawRTSTk.includes('-')) return; // skip non-ticket rows

      ticketNo    = cleanTicketNo(rawRTSTk);
      airlineCode = extractAirlineCode(rawRTSTk);
      pnr         = cell(row, iPNR).trim().toUpperCase();
      passengerName = cleanPassengerName(cell(row, iPassenger));

      const action = cell(row, iStatus).toLowerCase().trim();
      status = action === 'void' ? 'VOID' : action === 'issue' ? 'TKTT' : normaliseStatus(action);

      amount   = parseNum(cell(row, iAmount));
      totalDoc = Math.abs(amount);
      if (status === 'VOID') amount = 0;

      // Date: "4/29/26" → "2026-04-29"
      const rtsDateRaw = cell(row, iDate).trim();
      const rtsSerial  = parseInt(rtsDateRaw);
      if (!isNaN(rtsSerial) && rtsSerial > 40000) {
        date = new Date((rtsSerial - 25569) * 86400000).toISOString().split('T')[0];
      } else if (rtsDateRaw) {
        const parsed = new Date(rtsDateRaw);
        date = isNaN(parsed.getTime()) ? rtsDateRaw : parsed.toISOString().split('T')[0];
      }

      source = defaultSource || 'RTS';
      // Col 4 = req num: "ksaco379", "uaevp411", "SA 1161"
      reqNum = cleanReqNum(row[4] ? row[4].trim() : '');

    } else {
      /* ── REGEX FALLBACK ── */
      const ticketMatch = row.find((c: string) => /^\d{10,15}$/.test(c?.trim()));
      ticketNo = ticketMatch?.trim() || rowText.match(/\b\d{10,15}\b/)?.[0] || '';
      const pnrCell = row.find((c: string) => isValidPNR(c?.trim() || ''));
      pnr = pnrCell?.trim().toUpperCase() || '';
      const sm = rowText.match(/\b(TKTT|ISSU|VOID|REF|RFND|CANN|CANX|CNJ|EMDA|EMDS)\b/i);
      if (sm) status = normaliseStatus(sm[1]);
      if (ticketNo) {
        const nums = row.map((c: string) => parseFloat(c?.replace(/,/g, '')?.trim()))
          .filter((n: number) => !isNaN(n) && n !== 0 && Math.abs(n) < 1_000_000);
        amount = nums[0] ?? 0;
        totalDoc = Math.abs(amount);
      }
      airlineCode = extractAirlineCode(ticketNo);
      source = defaultSource || '';
    }

    /* ── Apply status → amount ── */
    if (format !== 'CUSTOM_IATA' && format !== 'IBTEKAR' && format !== 'NSA'
      && format !== 'AIRARABIA' && format !== 'FLYNAS' && format !== 'FLYDUBAI') {
      amount = applyStatusAmountLogic(amount, status);
    }
    if (totalDoc === 0) totalDoc = Math.abs(amount) + commission;

    /* ── Validate & push ── */
    const isLCC = format === 'FLYADEAL_DXB' || format === 'FLYADEAL_KSA'
      || format === 'FLYNAS' || format === 'FLYDUBAI';
    const validTicket = isLCC
      ? isValidPNR(ticketNo)
      : /^\d{8,15}$/.test(ticketNo);

    if (validTicket) {
      if (!reqNum && status !== 'TOPUP') errors.push(`Ticket ${ticketNo}: Missing Req Num — please review.`);
      if (!pnr && !isLCC && status !== 'TOPUP') errors.push(`Ticket ${ticketNo}: Missing PNR.`);

      tickets.push({
        id:            uuidv4(),
        ticketNo,
        pnr:           pnr.toUpperCase(),
        passengerName,
        airlineCode,
        route,
        source:        (source || '').substring(0, 40),
        date,
        amount,
        commission,
        totalDoc,
        reqNum,
        status,
        userId:        'temp',
      });
    } else if (row.some((c: string) => c?.trim())) {
      errors.push(`Row ${rowNumber}: Could not detect valid Ticket No/PNR. (${rowText.substring(0, 80)})`);
    }
  });

  return { tickets, errors };
}

/* ─────────────────────────────────────────────
   DUPLICATE DETECTION (within batch)
───────────────────────────────────────────── */
export function detectDuplicates(tickets: Ticket[]): Ticket[] {
  const seen = new Set<string>();
  return tickets.map(t => {
    const ticketKey = t.ticketNo.trim().toUpperCase();
    // Refunds on the same ticket number are NOT duplicates
    // Key includes status so TKTT and RFND on same ticket are separate
    const status = (t.status || '').toUpperCase();
    const key = status === 'RFND' || status === 'VOID' || status === 'CANN'
      ? `${ticketKey}_${status}`   // refund/void/cancel = unique entry
      : ticketKey;                 // regular ticket — check for true dups
    if (key && seen.has(key)) return { ...t, isDuplicate: true };
    if (key) seen.add(key);
    return { ...t, isDuplicate: false };
  });
}

/* ─────────────────────────────────────────────
   DUPLICATE vs EXISTING DB
───────────────────────────────────────────── */
export function detectDuplicatesAgainstExisting(
  newTickets: Ticket[],
  existingTickets: Ticket[]
): { fresh: Ticket[]; updates: Ticket[]; duplicates: Ticket[] } {
  const existingMap = new Map(
    existingTickets.map(t => [t.ticketNo.trim().toUpperCase(), t])
  );
  const fresh:      Ticket[] = [];
  const updates:    Ticket[] = [];
  const duplicates: Ticket[] = [];

  newTickets.forEach(t => {
    const key      = t.ticketNo.trim().toUpperCase();
    const status   = (t.status || '').toUpperCase();
    const existing = existingMap.get(key);

    // Refund/Void/Cancel on existing ticket = always FRESH (not a dup)
    // because a refund naturally references the original ticket number
    if (existing && (status === 'RFND' || status === 'VOID' || status === 'CANN' || status === 'TOPUP')) {
      fresh.push(t);
      return;
    }

    if (!existing) {
      fresh.push(t);
    } else if (t.reqNum && (!existing.reqNum || existing.reqNum.trim() === '')) {
      // Existing ticket missing req num + incoming has one → UPDATE req num only
      updates.push({ ...t, id: existing.id });
    } else if (t.reqNum && existing.reqNum && t.reqNum !== existing.reqNum) {
      // Different req num → UPDATE (correction)
      updates.push({ ...t, id: existing.id });
    } else {
      // True duplicate
      duplicates.push({ ...t, isDuplicate: true });
    }
  });

  return { fresh, updates, duplicates };
}
