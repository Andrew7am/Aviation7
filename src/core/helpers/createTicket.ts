import { v4 as uuidv4 } from 'uuid';
import { Ticket } from '../../types';
import { SupportedCurrency } from './resolveCurrency';
import { NormalizedStatus } from './normalizeStatus';

export interface TicketInput {
  ticketNo: string;
  pnr?: string;
  passengerName?: string;
  airlineCode?: string;
  route?: string;
  source: string;
  date: string;
  amount: number;
  totalDoc: number;
  commission: number;
  reqNum: string;
  status: NormalizedStatus;
  currency: SupportedCurrency;
  transactionType?: string;
  vendorReference?: string;
  reportName?: string;
  balanceAfter?: number;
}

export function createTicket(input: TicketInput): Ticket {
  return {
    id:              uuidv4(),
    ticketNo:        input.ticketNo.trim().toUpperCase(),
    pnr:             (input.pnr || '').trim().toUpperCase(),
    passengerName:   (input.passengerName || '').trim().toUpperCase(),
    airlineCode:     input.airlineCode || '',
    route:           input.route || '',
    source:          (input.source || '').substring(0, 40),
    date:            input.date,
    amount:          input.amount,
    totalDoc:        input.totalDoc,
    commission:      input.commission,
    reqNum:          (input.reqNum || '').trim().toUpperCase(),
    status:          input.status,
    currency:        input.currency,
    transactionType: input.transactionType || input.status,
    vendorReference: input.vendorReference || '',
    reportName:      input.reportName || '',
    balanceAfter:    input.balanceAfter,
    importTime:      new Date().toISOString(),
    isDuplicate:     false,
    userId:          'temp', // will be replaced on save
  };
}

export function createTopUp(params: {
  vendor: string;
  amount: number;
  date: string;
  currency: SupportedCurrency;
  reference?: string;
  reportName?: string;
}): Ticket {
  return createTicket({
    ticketNo:      `FUND_${Date.now()}`,
    passengerName: 'BALANCE TOP-UP',
    source:        params.vendor,
    date:          params.date,
    amount:        params.amount,
    totalDoc:      params.amount,
    commission:    0,
    reqNum:        '',
    status:        'FUND',
    currency:      params.currency,
    transactionType: 'FUND',
    vendorReference: params.reference || '',
    reportName:    params.reportName || '',
  });
}
