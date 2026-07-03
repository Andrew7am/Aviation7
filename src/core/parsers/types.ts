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
  detect:  (headers: string[]) => boolean;
  parse:   (
    rows:            string[][],
    headers:         string[],
    defaultCurrency: SupportedCurrency,
    defaultSource?:  string
  ) => ParserResult;
}
