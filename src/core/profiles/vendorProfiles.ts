/**
 * Vendor Profiles — defines column signals per vendor
 * Parser reads profile instead of hardcoded columns
 */
export interface VendorProfile {
  id: string;
  name: string;
  source: string;
  isLCC: boolean; // Low-cost carrier: uses PNR as ticket identifier
  detectSignals: string[];  // header signals that identify this format
  columns: {
    ticket?:    string[];
    pnr?:       string[];
    passenger?: string[];
    date?:      string[];
    amount?:    string[];
    net?:       string[];
    total?:     string[];
    commission?:string[];
    currency?:  string[];
    status?:    string[];
    airline?:   string[];
    route?:     string[];
    req?:       string[];  // overrides findReqColumn if set
    debit?:     string[];
    credit?:    string[];
  };
  skipRowIf?: (row: string[]) => boolean;
}

export const VENDOR_PROFILES: VendorProfile[] = [

  // ── OUR OWN EXPORT FORMAT ──
  {
    id: 'EXPORT', name: 'Custom Export', source: 'EXPORT', isLCC: false,
    detectSignals: ['ticket no.', 'req num'],
    columns: {
      ticket:     ['Ticket No.'],
      pnr:        ['PNR'],
      passenger:  ['Passenger', 'Pax'],
      date:       ['Date'],
      total:      ['Total Doc'],
      commission: ['Commission', 'Comm'],
      net:        ['Amount'],
      status:     ['Status'],
      req:        ['Req Num'],
      currency:   ['Currency'],
      route:      ['Route'],
    },
  },

  // ── IATA BSP ──
  {
    id: 'IATA', name: 'IATA BSP', source: 'IATA', isLCC: false,
    detectSignals: ['seq no', 'trnc', 'doc number'],
    columns: {
      ticket:     ['DOC NUMBER', 'DOCNUMBER'],
      pnr:        ['RLOC'],           // NOT AS (sales account)
      passenger:  ['PAX NAME', 'PAXNAME'],
      date:       ['DATE', 'ISSUE DATE', 'TRAVEL DATE'],
      total:      ['TOTAL DOC', 'TOTALDOC'],
      commission: ['COMM'],
      status:     ['TRNC'],
      airline:    ['A/L', 'AIRLINE', 'AL'],
      req:        ['Req Number', 'REQ NUMBER', 'REQ NUM'],
    },
  },

  // ── NSA ──
  {
    id: 'NSA', name: 'NSA', source: 'NSA', isLCC: false,
    detectSignals: ['lpo number', 'request number', 'doc no'],
    columns: {
      ticket:     ['Doc No'],
      pnr:        ['PNR'],
      passenger:  ['Description'],
      date:       ['DATE'],
      debit:      ['DEBIT', 'DEBIT (SAR)'],
      req:        ['Request Number'],
      route:      ['LPO NUMBER'],   // contains "International" / "domestic"
    },
  },

  // ── FLYADEAL DXB ──
  {
    id: 'FLYADEAL_DXB', name: 'FlyAdeal DXB', source: 'FlyAdeal DXB', isLCC: true,
    detectSignals: ['paymentdate', 'pnr', 'accountamount'],
    columns: {
      pnr:        ['pnr'],
      passenger:  ['passenger_Name', 'passenger_name', 'passenger'],
      date:       ['paymentDate', 'paymentdate'],
      amount:     ['accountAmount', 'accountamount', 'bookingAmount', 'bookingamount'],
      currency:   ['accountCurrency', 'accountcurrency'],
      status:     ['status', 'type'],
      req:        ['Req number', 'Req Number', 'REQ NUMBER', 'req'],
    },
    skipRowIf: (row) => {
      // Skip SAR-currency rows (internal transfers)
      const acctCurr = (row[11] || '').trim().toUpperCase();
      return acctCurr === 'SAR';
    },
  },

  // ── FLYADEAL KSA ──
  {
    id: 'FLYADEAL_KSA', name: 'FlyAdeal KSA', source: 'FlyAdeal KSA', isLCC: true,
    detectSignals: ['recordlocator', 'pnrtotal'],
    columns: {
      pnr:        ['recordLocator', 'recordlocator'],
      passenger:  ['passengerName', 'passengername'],
      date:       ['departureDate', 'departuredate'],
      amount:     ['pnrTotal', 'pnrtotal', 'totalInOrgCurrency'],
      status:     ['status'],
      route:      ['legDetails', 'legdetails'],
      req:        ['Req Number', 'Req number', 'REQ NUMBER'],
    },
  },

  // ── IBTEKAR ──
  {
    id: 'IBTEKAR', name: 'Ibtekar', source: 'Ibtekar', isLCC: false,
    detectSignals: ['file no', 'ticket', 'debit', 'sector'],
    columns: {
      ticket:     ['Ticket'],
      pnr:        ['PNR'],
      passenger:  ['Passenger'],
      date:       ['Issue Date'],
      debit:      ['Debit'],
      req:        ['File No', 'FileNo'],  // File No IS our Req Num
      route:      ['Sector'],
    },
    skipRowIf: (row) => {
      const tk = (row[3] || '').trim();
      const fileNo = (row[1] || '').trim().toUpperCase();
      // Skip RV rows (payment vouchers) unless they are TopUp
      if (/^RV\d+$/i.test(tk)) return true;
      // Skip rows without ticket pattern
      const hasTk = tk.includes(' - ') || /^\d{10,}$/.test(tk.replace(/\s/g, ''));
      const isTopUp = /^(topup|fund|top.?up)$/i.test(fileNo);
      return !hasTk && !isTopUp;
    },
  },

  // ── GOLD MEDAL ──
  {
    id: 'GOLDMEDAL', name: 'Gold Medal', source: 'Gold Medal', isLCC: false,
    detectSignals: ['customer no', 'routing', 'ticket number'],
    columns: {
      ticket:     ['Ticket Number', 'ticket number'],
      passenger:  ['Passenger Name', 'passenger name'],
      date:       ['Invoice Date'],
      amount:     ['Original Amount'],
      status:     ['Transaction_Type', 'transaction_type'],
      route:      ['Routing'],
    },
    // Gold Medal req: col 5 if it's a req pattern, else empty
    skipRowIf: (row) => {
      const rawTk = (row[13] || '').replace(/\s*\(\d+\s*PAX\)/i, '').replace(/[^0-9]/g, '');
      const gmCol5 = (row[5] || '').trim().toUpperCase().replace(/\s+/g, '');
      const hasTicket = rawTk && rawTk.length >= 8;
      const hasReq = gmCol5.length >= 2 && gmCol5 !== 'DUBAI' && !/^[A-Z]{9,}$/.test(gmCol5);
      return !hasTicket && !hasReq;
    },
  },

  // ── AIR ARABIA ──
  {
    id: 'AIRARABIA', name: 'AirArabia', source: 'AirArabia', isLCC: false,
    detectSignals: ['reference code', 'debit amount', 'ticket number'],
    columns: {
      ticket:     ['Ticket Number', 'ticket number'],
      pnr:        ['Remarks'],
      passenger:  ['Custmoner name', 'Customer name', 'customer name'],
      date:       ['Transaction date', 'Transaction Date'],
      debit:      ['Debit Amount', 'debit amount'],
      status:     ['Status'],
      req:        ['Request Number'],
    },
  },

  // ── FLYNAS ──
  {
    id: 'FLYNAS', name: 'Flynas', source: 'Flynas', isLCC: true,
    detectSignals: ['pnr2', 'req. number'],
    columns: {
      pnr:        ['PNR2'],
      passenger:  ['pax'],
      date:       ['Date'],
      amount:     ['AMOUNT'],
      route:      ['Column6', 'Route'],
      status:     ['Status'],
      req:        ['REQ. NUMBER', 'REQ NUMBER', 'Req Number'],
    },
    skipRowIf: (row) => {
      const pnr = (row[1] || '').trim().replace(/\s+/g, '').toUpperCase();
      const pax = (row[2] || '').trim();
      return /beg\.?\s*balance/i.test(pnr) || /beg\.?\s*balance/i.test(pax) || !pnr;
    },
  },

  // ── FLYDUBAI ──
  {
    id: 'FLYDUBAI', name: 'FlyDubai', source: 'FlyDubai', isLCC: true,
    detectSignals: ['invoice no', 'booking reference'],
    columns: {
      pnr:        ['Booking reference', 'booking reference'],
      passenger:  ['Passenger name', 'passenger name'],
      date:       ['Payment date', 'Booked date'],
      amount:     ['Amount'],
      status:     ['Status', 'Remarks'],
      req:        ['REQ Number', 'REQ NUMBER', 'Req Number'],
    },
    skipRowIf: (row) => {
      const pnr = (row[2] || '').trim().toUpperCase();
      return !pnr || pnr === 'NA' || pnr.length < 5;
    },
  },

  // ── RTS ──
  {
    id: 'RTS', name: 'RTS', source: 'RTS', isLCC: false,
    detectSignals: ['record locator', 'action'],
    columns: {
      pnr:        ['Record Locator'],
      ticket:     ['No'],
      passenger:  ['Passenger'],
      date:       ['PNR creation date'],
      amount:     ['Total'],
      status:     ['Action'],
      airline:    ['Carrier'],
      // RTS req: col index 4 always — detected by findReqColumn fallback
    },
    skipRowIf: (row) => {
      const tk = (row[3] || '').trim();
      return !tk || !tk.includes('-');
    },
  },
];

export function detectVendorProfile(headers: string[], defaultSource?: string): VendorProfile | null {
  const h = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9.]/g, ''));
  const hj = h.join('|');

  for (const profile of VENDOR_PROFILES) {
    const matched = profile.detectSignals.every(sig =>
      hj.includes(sig.toLowerCase().replace(/[^a-z0-9.]/g, ''))
    );
    if (matched) return profile;
  }

  // fallback: match by defaultSource
  if (defaultSource) {
    const ds = defaultSource.toUpperCase().replace(/\s+/g, '');
    const found = VENDOR_PROFILES.find(p =>
      p.id === ds ||
      p.source.toUpperCase().replace(/\s+/g, '') === ds ||
      p.name.toUpperCase().replace(/\s+/g, '') === ds
    );
    if (found) return found;
  }

  return null;
}
