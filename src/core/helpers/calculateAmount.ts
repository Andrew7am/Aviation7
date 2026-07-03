import { NormalizedStatus, statusToAmount } from './normalizeStatus';

export interface AmountResult {
  amount: number;
  totalDoc: number;
  commission: number;
  status: NormalizedStatus;
}

export function calculateAmount(params: {
  debit?: number;
  credit?: number;
  total?: number;
  net?: number;
  commission?: number;
  status: NormalizedStatus;
}): AmountResult {
  const { debit = 0, credit = 0, total = 0, net = 0, commission = 0, status } = params;

  let amount = 0;
  let totalDoc = 0;

  if (status === 'FUND') {
    // Fund/TopUp: credit or absolute total
    amount = credit > 0 ? credit : Math.abs(total || debit);
    totalDoc = amount;
  } else if (status === 'REFUND') {
    // Refund: negate
    const base = credit > 0 ? credit : debit > 0 ? debit : Math.abs(net || total);
    amount = -Math.abs(base);
    totalDoc = Math.abs(amount);
  } else {
    // ISSUE / ADM / ACM
    if (net !== 0) {
      amount = Math.abs(net);
      totalDoc = total > 0 ? total : amount + commission;
    } else if (total > 0 && commission >= 0) {
      amount = total - commission;
      totalDoc = total;
    } else if (debit > 0) {
      amount = debit;
      totalDoc = debit + commission;
    } else {
      amount = Math.abs(total || credit);
      totalDoc = amount;
    }
  }

  return { amount, totalDoc, commission, status };
}
