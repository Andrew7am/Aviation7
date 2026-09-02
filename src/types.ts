import { SupportedCurrency } from './core/helpers/resolveCurrency';
import { NormalizedStatus } from './core/helpers/normalizeStatus';

export interface Ticket {
  id: string;
  ticketNo: string;
  source: string;
  date: string;
  amount: number;
  commission: number;
  totalDoc: number;
  reqNum: string;
  pnr?: string;
  passengerName?: string;
  airlineCode?: string;
  route?: string;
  status?: NormalizedStatus | string;
  isDuplicate?: boolean;
  userId: string;
  importBatchId?: string;
  currency?: SupportedCurrency;
  transactionType?: string;
  reportName?: string;
  vendorReference?: string;
  balanceAfter?: number;
  importTime?: string;
  createdAt?: string;
  /** IATA BSP "Serial" column — a running sequence number in the vendor's own
   *  report. Lets the user spot gaps (missing tickets) by checking for skips
   *  in the sequence. Only populated for vendors whose report has one. */
  serial?: number;
  /** Follow-up workflow status independent of ISSUE/REFUND: true = Closed
   *  (reconciled/finalized with client), false = Not Closed (pending). */
  closed?: boolean;
  /** Settlement channel within a vendor (IATA: 'BSP' | 'WEBSALES-EDIS').
   *  Kept separate from `source`: source names the VENDOR and is what wallet
   *  matching keys on, so putting a channel there would move the row to a
   *  different (or non-existent) wallet. NULL for single-channel vendors. */
  channel?: string;
}

export type ViewState = 'dashboard' | 'tickets' | 'missing' | 'notclosed' | 'import' | 'vendors' | 'reports' | 'history' | 'activity';

export interface VendorBalance {
  id: string;
  vendorName: string;
  initialBalance: number;
  currentBalance: number;
  userId: string;
  createdAt?: string;
  /** The day the opening balance is true as of, YYYY-MM-DD. Tickets dated
   *  before it were settled beforehand and are not charged to this wallet.
   *  Unset charges every ticket the vendor ever issued — what wallets opened
   *  alongside the data need, and what they all did before this existed. */
  openingDate?: string;
}

export interface BalanceTopUp {
  id: string;
  vendorId: string;
  vendorName: string;
  amount: number;
  note: string;
  date: string;
  userId: string;
}

export interface ImportBatch {
  id: string;
  vendorName: string;
  ticketCount: number;
  totalAmount: number;
  date: string;
  userId: string;
}

/** The banner now carries one thing: what an import just skipped. Low balance
 *  moved to where it can be acted on (the Vendor Credit page and the sidebar
 *  count), and missing_req was never raised at all — the Action Required view
 *  is how that surfaces. */
export type AlertType = 'duplicate';

export interface AppAlert {
  id: string;
  type: AlertType;
  message: string;
  vendorName?: string;
  dismissed: boolean;
  createdAt: string;
}
