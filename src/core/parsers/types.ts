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
  isTopUp?:        boolean;
  skipRow?:        boolean;  // parser says skip this row silently
  rawError?:       string;   // parser error message for this row
}

export interface ParserResult {
  rows:     ParsedRow[];
  errors:   string[];
  warnings: string[];
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
    defaultSource?:  string
  ) => ParserResult;
}
