import { SupportedCurrency } from './core/helpers/resolveCurrency';
import { NormalizedStatus } from './core/helpers/normalizeStatus';

/** One field an import is about to overwrite, and what it holds today. */
export interface FieldChange {
  /** The name as a person reads it on screen, not the property name. */
  field: string;
  /** Empty when the record simply had nothing there — a gap being filled
   *  rather than a value being replaced, which is a different thing to see. */
  from: string;
  to: string;
}

/** One field an import is about to overwrite, and what it holds today. */
export interface FieldChange {
  /** The name as a person reads it on screen, not the property name. */
  field: string;
  /** Empty when the record simply had nothing there — a gap being filled
   *  rather than a value being replaced, which is a different thing to see. */
  from: string;
  to: string;
}

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
  /** What an incoming row will change on the record it matched, captured
   *  before the change is applied. Display only, and only ever set on an
   *  import preview's update rows: the count of updates tells you something
   *  is about to be overwritten, and this is what says what. Never persisted
   *  — the save path builds its patch field by field. */
  changes?: FieldChange[];
  /** IATA BSP "Serial" column — a running sequence number in the vendor's own
   *  report. Lets the user spot gaps (missing tickets) by checking for skips
   *  in the sequence. Only populated for vendors whose report has one. */
  serial?: number;
  /** Follow-up workflow status independent of ISSUE/REFUND: true = Closed
   *  (reconciled/finalized with client), false = Not Closed (pending). */
  closed?: boolean;
  /** Cabin sold: FIRST | BUSINESS | PREMIUM_ECONOMY | ECONOMY. Unset when the
   *  source said nothing, said it could not tell, or used a brand name that
   *  states no cabin — see core/helpers/cabinClass. */
  cabinClass?: string;
  /** The cabin exactly as the source wrote it, mixed journeys included
   *  ("Economy; Business"), so a reading can be revisited without the file. */
  cabinRaw?: string;
  /** Settlement channel within a vendor (IATA: 'BSP' | 'WEBSALES-EDIS').
   *  Kept separate from `source`: source names the VENDOR and is what wallet
   *  matching keys on, so putting a channel there would move the row to a
   *  different (or non-existent) wallet. NULL for single-channel vendors. */
  channel?: string;
}

export type ViewState = 'dashboard' | 'tickets' | 'missing' | 'notclosed' | 'import' | 'vendors' | 'statements' | 'reports' | 'history' | 'activity' | 'settings';

/**
 * A vendor's own account of a period, as their statement prints it.
 *
 * Kept for the vendors we issue against rather than buy from — Ibtekar and NSA
 * — because they adjust the account on their side after the fact and the
 * wallet, which is computed from our own rows, cannot see those adjustments.
 *
 * Signs follow the statement: a positive balance is credit in our favour
 * (their "Cr"), a negative one is what we owe (their "Dr"). The three
 * movements are positive magnitudes, and the period foots when
 * `opening + paid - billed - otherCharges === closing`.
 */
export interface VendorStatement {
  id: string;
  vendorName: string;
  /** Inclusive, YYYY-MM-DD. Vendors do not cut on month ends. */
  periodStart: string;
  periodEnd: string;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  /** What the vendor charged for tickets in the period. */
  billed: number;
  /** What we paid them in the period — their receipt vouchers. */
  paid: number;
  /** What the vendor added on their own side: service fees, penalties,
   *  corrections. None of it arrives as a ticket, so nothing else records it. */
  otherCharges: number;
  sourceFile?: string;
  note?: string;
  userId?: string;
  createdAt?: string;
}

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
