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
}

export type ViewState = 'dashboard' | 'tickets' | 'missing' | 'import' | 'vendors' | 'reports' | 'history';

export interface VendorBalance {
  id: string;
  vendorName: string;
  initialBalance: number;
  currentBalance: number;
  userId: string;
  createdAt?: string;
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

export type AlertType = 'low_balance' | 'duplicate' | 'missing_req';

export interface AppAlert {
  id: string;
  type: AlertType;
  message: string;
  vendorName?: string;
  dismissed: boolean;
  createdAt: string;
}
