/**
 * IATA commission/balance correction planning — pure calculation, no I/O.
 *
 * Says what a correction WOULD do to each row, and what the IATA totals would
 * become. Nothing here writes anything; the caller decides whether to act, and
 * so far the answer has always been "not yet".
 *
 * The categories come from what the ledger and the invoice actually disagree
 * about, which is not one thing:
 *
 *   A   the ledger holds the GROSS and never recorded the commission, so
 *       correcting it moves Balance Payable from gross to net — a change to
 *       what the agency owes, not just to a description of it.
 *   B   the ledger already holds the NET; only the commission field is blank.
 *       Filling it in changes no money at all.
 *   G   the ledger rounded to whole units. Internally consistent, sub-unit.
 *   CC  a credit-card sale: the invoice settles 0.00 and prints no commission,
 *       and the ledger agrees. Nothing to correct.
 *
 * Keeping them apart matters: A and B look identical if you only compare the
 * commission column, and merging them would quietly restate 19,790.00 of
 * balance payable under cover of a "commission fix".
 */

export type PlanCategory =
  | 'A genuine missing'
  | 'B already net'
  | 'G rounding'
  | 'CC card row'
  | 'A anomaly'
  | 'other';

export interface LedgerSide {
  id: string;
  ticketNo: string;
  type: string;
  channel: string | null;
  date: string;
  /** Stored as a magnitude; the sign lives on `payable`. */
  fare: number;
  commission: number;
  payable: number;
  /** Imported by the Phase 4 run — never a correction candidate. */
  phase4: boolean;
}

export interface InvoiceSide {
  type: string;
  channel: string;
  date: string;
  /** Magnitude, as the parser emits it. */
  fare: number;
  commission: number;
  payable: number;
}

export interface PlanRow {
  id: string;
  vendor: 'IATA BSP';
  document: string;
  transactionType: string;
  channel: string | null;
  date: string;
  currentFare: number;
  invoiceFare: number;
  currentCommission: number;
  invoiceCommission: number;
  currentBalancePayable: number;
  invoiceBalancePayable: number;
  /** What the row would hold afterwards. Equal to current where nothing moves. */
  newCommission: number;
  newBalancePayable: number;
  commissionDelta: number;
  balancePayableDelta: number;
  category: PlanCategory;
  proposedAction: string;
  /** Every §4 check, so a failure is visible rather than absorbed. */
  validation: Record<string, boolean>;
  phase4: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) < tol;

/** The ledger keeps the fare as a magnitude and the sign on the payable, so the
 *  sign has to be restored before the two sides can be compared at all. */
export const signedFare = (fare: number, payable: number): number =>
  payable < 0 ? -Math.abs(fare) : Math.abs(fare);

/**
 * Which kind of disagreement this is.
 *
 * Order matters. A card row is checked first because it is the one case where
 * payable and fare legitimately disagree by the whole fare, and every later
 * test would misread it.
 */
export function categorise(led: LedgerSide, inv: InvoiceSide): PlanCategory {
  const commDelta = cents(inv.commission - led.commission);
  const payDelta = cents(inv.payable - led.payable);

  if (inv.payable === 0 && inv.fare !== 0) return 'CC card row';
  if (Math.abs(led.commission) > 0.005 && Math.abs(commDelta) < 1.0) return 'G rounding';
  if (near(payDelta, 0)) return 'B already net';
  if (near(Math.abs(led.payable), Math.abs(inv.fare))) return 'A genuine missing';
  return 'other';
}

/** The §4 checks a category-A row must satisfy before it can be corrected. */
export function validateA(led: LedgerSide, inv: InvoiceSide): Record<string, boolean> {
  return {
    'invoice fare equals ledger fare': near(Math.abs(inv.fare), Math.abs(led.fare)),
    'invoice commission is non-zero': Math.abs(inv.commission) > 0.005,
    'ledger commission is zero': Math.abs(led.commission) < 0.005,
    'ledger payable equals the gross fare': near(led.payable, signedFare(inv.fare, led.payable)),
    'invoice payable equals fare minus commission':
      near(signedFare(inv.fare, inv.payable) - inv.commission, inv.payable),
  };
}

/**
 * Plan one row.
 *
 * Only A and B produce a change, and they change different things: A moves both
 * commission and balance payable, B moves commission alone. G, CC and anything
 * unclassified are returned untouched so they still appear in the preview.
 */
export function planRow(led: LedgerSide, inv: InvoiceSide): PlanRow {
  let category = categorise(led, inv);
  const validation = category === 'A genuine missing' ? validateA(led, inv) : {};
  // A row that fails its own checks is set aside rather than corrected blindly.
  if (category === 'A genuine missing' && Object.values(validation).some(v => !v)) {
    category = 'A anomaly';
  }

  let newCommission = led.commission;
  let newBalancePayable = led.payable;
  let proposedAction: string;

  switch (category) {
    case 'A genuine missing':
      newCommission = inv.commission;
      newBalancePayable = inv.payable;
      proposedAction = 'SET commission AND move balance payable from gross to net';
      break;
    case 'B already net':
      newCommission = inv.commission;
      proposedAction = 'SET commission only — balance payable is already correct';
      break;
    case 'G rounding':
      proposedAction = 'NO CHANGE — rounding difference';
      break;
    case 'CC card row':
      proposedAction = 'NO CHANGE — credit-card sale, invoice settles nothing';
      break;
    case 'A anomaly':
      proposedAction = 'NO CHANGE — fails the category A checks, needs review';
      break;
    default:
      proposedAction = 'NO CHANGE — unclassified, needs review';
  }

  // A Phase-4 import is never a correction candidate, whatever it looks like.
  if (led.phase4 && (category === 'A genuine missing' || category === 'B already net')) {
    newCommission = led.commission;
    newBalancePayable = led.payable;
    proposedAction = 'NO CHANGE — imported by Phase 4, excluded from correction';
  }

  return {
    id: led.id, vendor: 'IATA BSP', document: led.ticketNo,
    transactionType: led.type, channel: led.channel, date: led.date,
    currentFare: led.fare, invoiceFare: inv.fare,
    currentCommission: led.commission, invoiceCommission: inv.commission,
    currentBalancePayable: led.payable, invoiceBalancePayable: inv.payable,
    newCommission, newBalancePayable,
    commissionDelta: cents(newCommission - led.commission),
    balancePayableDelta: cents(newBalancePayable - led.payable),
    category, proposedAction, validation, phase4: led.phase4,
  };
}

export interface CategoryTotal {
  rows: number;
  invoiceCommission: number;
  ledgerCommission: number;
  commissionDelta: number;
  balancePayableDelta: number;
  phase4Rows: number;
}

export function summarise(rows: PlanRow[]): Record<string, CategoryTotal> {
  const out: Record<string, CategoryTotal> = {};
  for (const r of rows) {
    const t = out[r.category] ??= {
      rows: 0, invoiceCommission: 0, ledgerCommission: 0,
      commissionDelta: 0, balancePayableDelta: 0, phase4Rows: 0,
    };
    t.rows++;
    t.invoiceCommission = cents(t.invoiceCommission + r.invoiceCommission);
    t.ledgerCommission = cents(t.ledgerCommission + r.currentCommission);
    t.commissionDelta = cents(t.commissionDelta + r.commissionDelta);
    t.balancePayableDelta = cents(t.balancePayableDelta + r.balancePayableDelta);
    if (r.phase4) t.phase4Rows++;
  }
  return out;
}

/* ── the three missing BSP issues ───────────────────────────────────────── */

export interface IssueStub {
  document: string;
  /** The TKTT the invoice billed but the ledger never received. */
  invoiceIssue: { date: string; fare: number; commission: number; payable: number };
  /** The refund that IS in the ledger (imported by Phase 4). */
  ledgerRefund: { date: string; payable: number };
  /** The zero-value VOID the agency recorded locally. */
  localVoid: { id: string; date: string };
}

export interface IssuePlan extends IssueStub {
  /** What the document is really worth: issue plus refund. */
  trueNet: number;
  /** What the ledger currently shows for it. */
  ledgerNet: number;
  /** How far the ledger understates it. */
  understatement: number;
  classification: 'MISSING BSP ISSUE + EXISTING LOCAL VOID';
  proposedAction: string;
}

export function planIssueStubs(stubs: IssueStub[]): IssuePlan[] {
  return stubs.map(s => {
    const trueNet = cents(s.invoiceIssue.payable + s.ledgerRefund.payable);
    const ledgerNet = cents(s.ledgerRefund.payable);
    return {
      ...s,
      trueNet, ledgerNet,
      understatement: cents(trueNet - ledgerNet),
      classification: 'MISSING BSP ISSUE + EXISTING LOCAL VOID',
      // Deliberately not merged with the commission work: this is a missing
      // transaction, not a mis-stated field, and the local VOID says the
      // agency believed the ticket was cancelled. Both facts are real.
      proposedAction: 'NO CHANGE — would require INSERTing the BSP issue; the local VOID stays either way',
    };
  });
}

/* ── projected totals ───────────────────────────────────────────────────── */

export interface Totals { transactions: number; fare: number; commission: number; balancePayable: number }

export interface Scenarios {
  current: Totals;
  /** A + B commission only. Balance payable untouched. */
  scenarioA: Totals;
  /** Scenario A plus category A's gross→net move. */
  scenarioB: Totals;
  /** Scenario B plus the three missing BSP issues. */
  scenarioC: Totals;
}

export function projectScenarios(
  current: Totals,
  totals: Record<string, CategoryTotal>,
  issues: IssuePlan[],
): Scenarios {
  const commA = totals['A genuine missing']?.commissionDelta ?? 0;
  const commB = totals['B already net']?.commissionDelta ?? 0;
  const payA = totals['A genuine missing']?.balancePayableDelta ?? 0;

  const scenarioA: Totals = {
    transactions: current.transactions,
    fare: current.fare,
    commission: cents(current.commission + commA + commB),
    balancePayable: current.balancePayable,
  };
  const scenarioB: Totals = { ...scenarioA, balancePayable: cents(current.balancePayable + payA) };
  const issueFare = cents(issues.reduce((s, i) => s + i.invoiceIssue.fare, 0));
  const issuePayable = cents(issues.reduce((s, i) => s + i.invoiceIssue.payable, 0));
  const scenarioC: Totals = {
    transactions: current.transactions + issues.length,
    fare: cents(current.fare + issueFare),
    // The three issues carry no commission, so only fare and payable move.
    commission: scenarioB.commission,
    balancePayable: cents(scenarioB.balancePayable + issuePayable),
  };
  return { current, scenarioA, scenarioB, scenarioC };
}
