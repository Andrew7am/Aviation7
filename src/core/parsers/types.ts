import { Ticket } from '../../types';
import { SupportedCurrency } from '../helpers/resolveCurrency';

/** Every parser returns this — never saves directly */
export interface ParsedRow {
  ticketNo:        string;
  pnr?:            string;
  passengerName?:  string;
  airlineCode?:    string;
  route?:          string;
  date:            string;
  amount:          number;
  totalDoc?:       number;
  commission?:     number;
  reqNum:          string;
  vendorReference?: string; // raw, untouched reference text from the source file (booking/file/PO no.)
  status:          string;
  currency:        SupportedCurrency;
  serial?:         number;   // vendor's own running sequence number (IATA), if present
  /** Vendor-reported reconciliation state, when their report carries one
   *  (Ibtekar's sheet has a Closed / Not Closed column). */
  closed?:         boolean;
  /** Per-row vendor, for formats that carry their own Source column and can
   *  therefore span several vendors in one file (our own re-import export).
   *  When unset the import falls back to the single source chosen in the UI. */
  source?:         string;
  /** Settlement channel WITHIN a vendor (IATA: BSP vs WEBSALES-EDIS).
   *  Distinct from source, which identifies the vendor and drives wallet
   *  matching — a channel must never change which wallet a row belongs to. */
  channel?:        string;
  /** The vendor's own document-type code, kept verbatim even when it maps to
   *  no known status, so an unrecognised type stays visible rather than lost. */
  rawType?:        string;
  /** For a refund, the ticket it refunds — BSP's +RTDN line. */
  relatedTicket?:  string;
  /** A reissue at no charge: the document it replaces. Kept at 0 and filed
   *  under that ticket's request, PNR and passenger on import. */
  reissueOf?:      string;
  /** A reissue at no charge whose report does not say what it replaces
   *  (RTS). Filed on import under the ticket with its PNR and passenger. */
  freeReissue?:    boolean;
  /** Cabin sold, read from whatever the report called it. Both are set
   *  together: the reading, and the text it was read from. */
  cabinClass?:     string;
  cabinRaw?:       string;
  isTopUp?:        boolean;
  skipRow?:        boolean;  // parser says skip this row silently
  rawError?:       string;   // parser error message for this row
}

/** One document replacing another — a reissue. */
export interface ExchangeEdge {
  ticketNo:       string;
  replacedTicket: string;
  airlineCode?:   string;
  date?:          string;
  /** What the reissue collected; 0 for an even exchange. */
  fee:            number;
}

export interface ParserResult {
  rows:     ParsedRow[];
  errors:   string[];
  warnings: string[];
  /** Reissues the file records, including the zero-value ones that never
   *  become ledger rows — the link is real even when the money is nil. */
  exchanges?: ExchangeEdge[];
}

export interface VendorParser {
  id:      string;
  name:    string;
  /** Set when the vendor's export has NO header row (pure data from row 1).
   *  runParser then hands every row to parse() instead of treating the first
   *  one as headers and slicing it off. */
  headerless?: boolean;
  detect:  (headers: string[]) => boolean;
  parse:   (
    rows:            string[][],
    headers:         string[],
    defaultCurrency: SupportedCurrency,
    defaultSource?:  string,
    /** Whatever sat ABOVE the header row. Most formats put nothing there, but
     *  a BSP sales report prints its date range and currency in that block and
     *  nowhere else — see helpers/reportPeriod. */
    preamble?:       string[][]
  ) => ParserResult;
}
