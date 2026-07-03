export enum TransactionType {
  ISSUE = 'ISSUE',
  REFUND = 'REFUND',
  FUND = 'FUND',
  ADM = 'ADM',
  ACM = 'ACM',
  OPENING = 'OPENING',
  ADJUSTMENT = 'ADJUSTMENT',
  UNKNOWN = 'UNKNOWN',
}

export interface Transaction {

  id?: string;

  vendor: string;

  transactionType: TransactionType;

  ticketNumber?: string;

  invoiceNumber?: string;

  pnr?: string;

  passenger?: string;

  reqNumber?: string;

  amount?: number;

  currency?: string;

  balance?: number;

  issueDate?: Date;

  remarks?: string;

  sourceReport?: string;

  confidence?: number;

  rawData: Record<string, unknown>;
}