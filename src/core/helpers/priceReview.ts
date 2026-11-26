import type { Ticket } from '../../types';
import { aviationProfit, toCurrency, riyadhDay, ourPart, PROFIT_FROM, type ProfitSheetRow, type OurPart } from './aviationProfit';
import { ticketMatchKey, isBookingRef } from './ticketIdentity';
import { reqTokensOf } from './reqTokens';
import { isHiddenProfit, withoutAvMark } from './aviationMark';

/**
 * A file's prices, ticket by ticket: what the aviation team gave operations
 * against what the ticket cost us.
 *
 * The user's example (26 Nov 2026): a 1,000 ticket with 100 commission is
 * 900 to us. Given to operations at 1,100, we make 200 - the 100 commission
 * and the team's 100 markup. Given at 900, the team gave the commission
 * away and somebody should say why; below 900, it was sold at a loss.
 *
 * Their Net Cost is what operations was given, from 9 Nov (PROFIT_FROM).
 * Before that it was the real cost, so those tickets are only counted.
 * A refund: what the supplier gave us back against their Refund Amount.
 */

/** A riyal or dirham either way is rounding, not a decision. */
export const PRICE_TOLERANCE = 1;

export type PriceResult =
  | 'MARKUP' | 'COMMISSION_ONLY' | 'PART_COMMISSION' | 'EXACTLY_NET' | 'BELOW_NET'
  | 'REFUND_SAME' | 'REFUND_KEPT' | 'REFUND_ABOVE' | 'AV_PROFIT' | 'CURRENCY_WRONG' | 'NOT_COMPARED';

export const RESULT_LABEL: Record<PriceResult, string> = {
  MARKUP: 'Markup', COMMISSION_ONLY: 'Commission only', PART_COMMISSION: 'Part of commission',
  EXACTLY_NET: 'Exactly net', BELOW_NET: 'Below net',
  REFUND_SAME: 'Refund as ours', REFUND_KEPT: 'Refund: we kept some', REFUND_ABOVE: 'Refund above ours',
  AV_PROFIT: 'Aviation profit (AV)',
  CURRENCY_WRONG: 'Currency written wrong',
  NOT_COMPARED: 'Not compared',
};
export const RESULT_MEANS: Record<PriceResult, string> = {
  MARKUP: 'Given to operations above the ticket price: commission and markup are both ours.',
  COMMISSION_ONLY: 'Given at the ticket price: only the commission is ours.',
  PART_COMMISSION: 'Given below the ticket price: part of the commission was given away.',
  EXACTLY_NET: 'Given at exactly our net cost: no profit at all.',
  BELOW_NET: 'Given below what the ticket cost us: a loss.',
  REFUND_SAME: 'Operations got back what the supplier refunded.',
  REFUND_KEPT: 'Operations got back less than the supplier refunded: the rest stays with the aviation team.',
  REFUND_ABOVE: 'Operations got back more than the supplier refunded: a loss.',
  AV_PROFIT: 'Refunded to us and marked AV: not given back to operations, so the aviation team\u2019s profit. Not on their sheet.',
  CURRENCY_WRONG: 'Their sheet has our own figure in another currency: a currency written wrong, so compared in ours.',
  NOT_COMPARED: '',
};
/** Results somebody should explain. */
export const NEEDS_REASON = new Set<PriceResult>(['PART_COMMISSION', 'EXACTLY_NET', 'BELOW_NET', 'REFUND_ABOVE']);
/** Results that keep a file from closing until a reason is written. */
export const BLOCKS_CLOSING = new Set<PriceResult>(['BELOW_NET', 'REFUND_ABOVE']);

/* Before 9 Nov their Net Cost was the cost, so a ticket then at or below
   ours is how they wrote it, not a decision: shown and added up, never asked
   about, never holding a file. */
/* A currency written wrong is judged by what it is in our currency: a real
   loss there still holds the file. */
const judged = (l: Pick<PriceLine, 'result' | 'asOurs'>) => (l.result === 'CURRENCY_WRONG' ? l.asOurs ?? l.result : l.result);
export const needsReason = (l: Pick<PriceLine, 'result' | 'early' | 'asOurs'>) => NEEDS_REASON.has(judged(l)) && !l.early;
export const blocksClosing = (l: Pick<PriceLine, 'result' | 'early' | 'asOurs'>) => BLOCKS_CLOSING.has(judged(l)) && !l.early;

export interface PriceLine {
  /** Stable across runs: the reason written for it is kept against this. */
  key: string;
  kind: 'SALE' | 'REFUND';
  req: string; member: string; issued: string; docs: string[]; currency: string;
  /** Issued before 9 Nov, when their Net Cost was the cost. */
  early?: boolean;
  /** The fare: our net + the commission. A refund has none. */
  price: number | null;
  commission: number | null;
  /** What the ticket cost us; for a refund, what the supplier gave back. */
  net: number | null;
  /** Their Net Cost; for a refund, their Refund Amount. */
  toOps: number;
  /** To operations less the fare: the team's own part. */
  markup: number | null;
  /** Everything we made on it: commission + markup; on a refund, what we kept. */
  profit: number | null;
  result: PriceResult;
  /** Why it was not compared. */
  why?: string;
  converted: boolean;
  /** CURRENCY_WRONG: the currency their sheet wrote, and the result in ours. */
  writtenAs?: string;
  asOurs?: PriceResult;
  /** Their figure was in dollars or euros: what they wrote, and the rate it was
   *  turned into our currency at (the user, 26 Nov 2026: those go to dirhams). */
  theirs?: { currency: string; amount: number; rate: number; ownRate: boolean };
  /** Our tickets behind it, as our books have them. */
  ours?: OurPart[];
  /** The figures the reason was written against: change them and it is asked again. */
  fingerprint: string;
}

/** Their figure is one of ours (net or fare) in our own currency: written in the wrong one. */
const sameFigure = (theirs: number, ...ours: number[]) => ours.some(v => Math.abs(theirs - v) <= Math.max(0.5, Math.abs(v) * 0.005));
/** The one currency all of these are in, or ''. */
const oneCurrency = (ps: OurPart[]) => { const c = [...new Set(ps.map(p => p.currency))]; return c.length === 1 ? c[0] : ''; };
/** The currencies the file is kept in. Dollars and euros are turned into them. */
const HOME = new Set(['SAR', 'AED']);
/**
 * The rate their dollar or euro figure becomes ours at: the one the purchase
 * itself was booked at in our books (808.40 USD booked as 2,969.74 AED), else
 * the peg. Null when there is neither (euros with no booked rate).
 */
function rateInto(ps: OurPart[], from: string, into: string): { rate: number; ownRate: boolean } | null {
  const booked = ps.length > 0 && ps.every(p => p.origCurrency === from && (p.origAmount ?? 0) !== 0);
  if (booked) {
    const orig = ps.reduce((n, p) => n + Math.abs(p.origAmount!), 0), amt = ps.reduce((n, p) => n + Math.abs(p.amount), 0);
    if (orig > 0) return { rate: amt / orig, ownRate: true };
  }
  const peg = toCurrency(1, from, into);
  return peg === null ? null : { rate: peg, ownRate: false };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A sale's result from what operations was given, our net and the commission. */
export function classify(toOps: number, net: number, commission: number): PriceResult {
  const profit = toOps - net, markup = toOps - (net + commission);
  if (profit < -PRICE_TOLERANCE) return 'BELOW_NET';
  if (profit <= PRICE_TOLERANCE) return 'EXACTLY_NET';
  if (markup > PRICE_TOLERANCE) return 'MARKUP';
  if (markup >= -PRICE_TOLERANCE) return 'COMMISSION_ONLY';
  return 'PART_COMMISSION';
}

const NOT_COMPARED_WHY: Record<string, string> = {
  NOT_IN_BOOKS: 'Not in our books yet',
  AWAITING_SUPPLIER: "Waiting for the supplier's report: our figure is still theirs",
  TWO_CURRENCIES: 'Priced in currencies that cannot be compared',
};

export interface PriceOptions {
  from?: string; to?: string;
  voided?: Iterable<string>;
  /** Only these requests - their request or ours. Empty: every request. */
  requests?: string[];
  /** A whole file: every ticket of it, whatever its date (the user, 26 Nov
   *  2026: what operations was charged is their sheet, for all of it).
   *  Without it, from 9 Nov. */
  wholeFile?: boolean;
}

export function priceReview(rows: ProfitSheetRow[], ledger: Ticket[], opts: PriceOptions = {}): PriceLine[] {
  const from = opts.wholeFile ? (opts.from || '') : !opts.from || opts.from < PROFIT_FROM ? PROFIT_FROM : opts.from, to = opts.to || '';
  const voided = [...(opts.voided ?? [])];
  const gone = new Set(voided.map(ticketMatchKey).filter(Boolean));
  const byDoc = new Map<string, Ticket[]>();
  for (const t of ledger) {
    if ((t.status || '').toUpperCase() === 'FUND') continue;
    const k = ticketMatchKey(t.ticketNo || '');
    if (k) byDoc.set(k, [...(byDoc.get(k) ?? []), t]);
  }
  const want = new Set((opts.requests ?? []).flatMap(reqTokensOf));
  const inScope = (theirReq: string, docs: string[]) => !want.size
    || reqTokensOf(theirReq).some(r => want.has(r))
    || docs.some(d => (byDoc.get(ticketMatchKey(d)) ?? []).some(t => reqTokensOf(t.reqNum || '').some(r => want.has(r))));

  const out: PriceLine[] = [];
  for (const l of aviationProfit(rows, ledger, from, to, voided, { refunded: true })) {
    if (!inScope(l.req, l.docs)) continue;
    const base = { key: `PRICE|${l.key}`, kind: 'SALE' as const, req: l.req, member: l.member, issued: l.issued,
      docs: l.docs, currency: l.currency, toOps: l.quoted, converted: l.converted, ours: l.ours };
    /* Ours in one currency, theirs in another: a euro figure cannot be
       converted at a peg, but can at the rate the purchase was booked at. */
    const oc = l.ours?.length && (l.state === 'COUNTED' || (l.state === 'TWO_CURRENCIES' && !l.mixedSheet))
      ? oneCurrency(l.ours) : '';
    /* Their 3,960 SAR on our 3,960 AED is our figure in the wrong currency,
       not a loss of 84 riyals (KSAML2771, 26 Nov 2026): compared in ours. */
    if (oc && oc !== l.currency) {
      const cost = r2(l.ours!.reduce((n, p) => n + p.amount, 0)), comm = r2(l.ours!.reduce((n, p) => n + p.commission, 0));
      if (sameFigure(l.quoted, cost, cost + comm)) {
        const price = r2(cost + comm);
        out.push({ ...base, currency: oc, converted: false, writtenAs: l.currency, early: l.issued < PROFIT_FROM,
          price, commission: comm, net: cost, markup: r2(l.quoted - price), profit: r2(l.quoted - cost),
          result: 'CURRENCY_WRONG', asOurs: classify(l.quoted, cost, comm), fingerprint: `${l.quoted}|${cost}|${comm}|${l.currency}` });
        continue;
      }
    }
    /* Their figure in dollars or euros, ours in dirhams or riyals: theirs is
       turned into ours, at the rate the purchase was booked at, so the file
       stays in its own currencies (the user, 26 Nov 2026). */
    if (oc && HOME.has(oc) && !HOME.has(l.currency)) {
      const fx = rateInto(l.ours!, l.currency, oc);
      if (fx) {
        const cost = r2(l.ours!.reduce((n, p) => n + p.amount, 0)), comm = r2(l.ours!.reduce((n, p) => n + p.commission, 0));
        const toOps = r2(l.quoted * fx.rate), price = r2(cost + comm);
        out.push({ ...base, currency: oc, toOps, converted: false, early: l.issued < PROFIT_FROM,
          theirs: { currency: l.currency, amount: l.quoted, rate: fx.rate, ownRate: fx.ownRate },
          price, commission: comm, net: cost, markup: r2(toOps - price), profit: r2(toOps - cost),
          result: classify(toOps, cost, comm), fingerprint: `${l.quoted}|${l.currency}|${cost}|${comm}` });
        continue;
      }
    }
    if (l.state !== 'COUNTED' || l.cost === null) {
      out.push({ ...base, price: null, commission: null, net: null, markup: null, profit: null, result: 'NOT_COMPARED',
        why: NOT_COMPARED_WHY[l.state] ?? l.state, fingerprint: `${l.quoted}` });
      continue;
    }
    const commission = l.commission ?? 0, price = r2(l.cost + commission);
    out.push({ ...base, early: l.issued < PROFIT_FROM, price, commission, net: l.cost, markup: r2(l.quoted - price), profit: r2(l.quoted - l.cost),
      result: classify(l.quoted, l.cost, commission), fingerprint: `${l.quoted}|${l.cost}|${commission}` });
  }

  /* Refunds: one line per document set, their Refund Amount against what the
     supplier gave us back for the same documents. */
  const refunds = new Map<string, ProfitSheetRow[]>();
  for (const r of rows) {
    if (!/cancel|refund/i.test(r.status || '')) continue;
    const d = riyadhDay(r.issued_at);
    if (d < from || (to && d > to)) continue;
    const docs = [...new Set(r.serials.map(ticketMatchKey).filter(k => k && !isBookingRef(k) && !gone.has(k)))].sort();
    if (!docs.length) continue;
    const k = docs.join('/');
    refunds.set(k, [...(refunds.get(k) ?? []), r]);
  }
  for (const [k, g] of refunds) {
    const first = g[0], docs = k.split('/');
    if (!inScope(first.req_num, docs)) continue;
    const currency = (first.currency || '').toUpperCase();
    const given = g.some(r => r.refund_amount != null) ? r2(g.reduce((n, r) => n + (r.refund_amount ?? 0), 0)) : null;
    const ours = docs.flatMap(d => byDoc.get(d) ?? []).filter(t => (t.amount || 0) < 0 && !isHiddenProfit(t));
    const parts = ours.map(t => ourPart(t, currency));
    let back = 0, recalled = 0, converted = false, ok = true;
    for (const t of ours) {
      const cur = (t.currency || currency).toUpperCase();
      const v = cur === currency ? Math.abs(t.amount) : toCurrency(Math.abs(t.amount), cur, currency);
      if (v === null) { ok = false; break; }
      /* The commission the supplier takes back with a refund, kept on the row
         as a negative figure: our commission goes down by it. */
      recalled += Math.abs((cur === currency ? t.commission : toCurrency(t.commission || 0, cur, currency)) || 0);
      back += v; if (cur !== currency) converted = true;
    }
    const base = { key: `REFUND|${g.map(r => r.record_id).join('+')}`, kind: 'REFUND' as const, req: first.req_num,
      early: riyadhDay(first.issued_at) < PROFIT_FROM,
      member: (first.team_member || '').trim() || '(no name)', issued: riyadhDay(first.issued_at), docs, currency,
      toOps: given ?? 0, price: null, commission: null, converted, ours: parts };
    /* Their Refund Amount in the wrong currency, the same as for a sale. */
    const oc = given !== null && parts.length ? oneCurrency(parts) : '';
    if (oc && oc !== currency) {
      const b = r2(parts.reduce((n, p) => n + Math.abs(p.amount), 0)), rc = r2(parts.reduce((n, p) => n + Math.abs(p.commission), 0));
      if (sameFigure(given!, b, b + rc)) {
        const g = r2(b + rc), t2 = r2(g - given!);
        out.push({ ...base, currency: oc, converted: false, writtenAs: currency, price: g, commission: r2(-rc) || 0, net: b,
          markup: t2, profit: r2(b - given!), result: 'CURRENCY_WRONG',
          asOurs: t2 < -PRICE_TOLERANCE ? 'REFUND_ABOVE' : t2 > PRICE_TOLERANCE ? 'REFUND_KEPT' : 'REFUND_SAME',
          fingerprint: `${given}|${b}|${rc}|${currency}` });
        continue;
      }
    }
    if (oc && HOME.has(oc) && !HOME.has(currency)) {
      const fx = rateInto(parts, currency, oc);
      if (fx) {
        const b = r2(parts.reduce((n, p) => n + Math.abs(p.amount), 0)), rc = r2(parts.reduce((n, p) => n + Math.abs(p.commission), 0));
        const g = r2(b + rc), mine = r2(given! * fx.rate), t2 = r2(g - mine);
        out.push({ ...base, currency: oc, toOps: mine, converted: false,
          theirs: { currency, amount: given!, rate: fx.rate, ownRate: fx.ownRate },
          price: g, commission: r2(-rc) || 0, net: b, markup: t2, profit: r2(b - mine),
          result: t2 < -PRICE_TOLERANCE ? 'REFUND_ABOVE' : t2 > PRICE_TOLERANCE ? 'REFUND_KEPT' : 'REFUND_SAME',
          fingerprint: `${given}|${currency}|${b}|${rc}` });
        continue;
      }
    }
    const why = given === null ? 'No Refund Amount on their sheet' : !ours.length ? 'Refund not in our books yet'
      : !ok ? 'Priced in currencies that cannot be compared' : '';
    if (why) { out.push({ ...base, net: null, markup: null, profit: null, result: 'NOT_COMPARED', why, fingerprint: `${given}` }); continue; }
    /* The refund before its commission came back off is what the ticket
       refunded; the team's part is that less what operations got back. The
       commission the supplier took back is commission's, not the team's: a
       full fare returned to operations is no loss of theirs. */
    const gross = r2(back + recalled), team = r2(gross - given!);
    out.push({ ...base, price: gross, commission: r2(-recalled) || 0, net: r2(back), markup: team, profit: r2(back - given!),
      result: team < -PRICE_TOLERANCE ? 'REFUND_ABOVE' : team > PRICE_TOLERANCE ? 'REFUND_KEPT' : 'REFUND_SAME',
      fingerprint: `${given}|${r2(back)}|${r2(recalled)}` });
  }
  /* Refunds marked AV in our books: the airline paid us back and operations
     was not, so all of it is the aviation team's. On no sheet of theirs, and
     from whatever day - the mark is a person's, not their Net Cost's. */
  for (const t of ledger) {
    if (!isHiddenProfit(t) || ticketMatchKey(t.ticketNo || '') && gone.has(ticketMatchKey(t.ticketNo || ''))) continue;
    const day = (t.date || '').slice(0, 10);
    if ((opts.from && day < opts.from) || (opts.to && day > opts.to)) continue;
    const req = withoutAvMark(t.reqNum);
    if (want.size && !reqTokensOf(req).some(r => want.has(r))) continue;
    const back = r2(Math.abs(t.amount || 0)), recalled = r2(Math.abs(Number(t.commission) || 0));
    out.push({ key: `AV|${t.id}`, kind: 'REFUND', req, member: 'Marked AV', issued: day,
      docs: [t.ticketNo || t.pnr || ''], currency: (t.currency || '').toUpperCase(), toOps: 0,
      price: r2(back + recalled), commission: r2(-recalled) || 0, net: back, markup: r2(back + recalled), profit: back,
      result: 'AV_PROFIT', converted: false, ours: [ourPart(t)], fingerprint: `${back}|${recalled}` });
  }
  return out.sort((a, b) => a.req.localeCompare(b.req) || a.issued.localeCompare(b.issued) || a.kind.localeCompare(b.kind));
}

/**
 * A file's money, the user's way (26 Nov 2026): charged to operations 100,000
 * = our net 80,000 + commission 10,000 + aviation profit 10,000. After
 * refunds: a refund takes what operations got back off the charge, what the
 * supplier gave back off our net, and the commission it took back off ours.
 */
export interface PriceTotal {
  req: string; currency: string; tickets: number;
  /** What operations paid: their Net Cost, less their Refund Amount. */
  charged: number;
  /** What it cost us: sales less refunds, after commission. */
  net: number;
  /** The supplier's commission, less what refunds took back. */
  commission: number;
  /** The team's part: markup + below price + refunds. charged = net + commission + aviation. */
  aviation: number;
  /** Sales alone: the fares, and what operations was given for them. */
  price: number; toOps: number;
  /** Above the fare, added up: the team's markup. */
  markup: number;
  /** Below the fare, added up (negative): commission given away, and any loss. */
  belowPrice: number;
  /** The team's part of refunds: kept (+) or given back over (-). */
  refunds: number;
  /** Everything we made: commission + aviation = charged - net. */
  profit: number;
  counts: Partial<Record<PriceResult, number>>;
}

/** Added up per request and currency (SAR and AED are never summed). `req` 'ALL' for the whole. */
export function priceTotals(lines: PriceLine[], byRequest = true): PriceTotal[] {
  const m = new Map<string, PriceTotal>();
  for (const l of lines) {
    const req = byRequest ? (l.req || '(no request)') : 'ALL';
    const k = `${req}|${l.currency}`;
    const t = m.get(k) ?? { req, currency: l.currency, tickets: 0, charged: 0, net: 0, commission: 0, aviation: 0,
      price: 0, toOps: 0, markup: 0, belowPrice: 0, refunds: 0, profit: 0, counts: {} };
    t.counts[l.result] = (t.counts[l.result] ?? 0) + 1;
    if (l.result !== 'NOT_COMPARED') {
      if (l.kind === 'SALE') {
        t.tickets += Math.max(1, l.docs.length);
        t.charged += l.toOps; t.net += l.net!; t.price += l.price!; t.toOps += l.toOps;
        if (l.markup! > 0) t.markup += l.markup!; else t.belowPrice += l.markup!;
      } else {
        t.charged -= l.toOps; t.net -= l.net!; t.refunds += l.markup!;
      }
      t.commission += l.commission!; t.aviation += l.markup!;
    }
    m.set(k, t);
  }
  return [...m.values()].map(t => ({ ...t, charged: r2(t.charged), net: r2(t.net), commission: r2(t.commission),
    aviation: r2(t.aviation), price: r2(t.price), toOps: r2(t.toOps), markup: r2(t.markup), belowPrice: r2(t.belowPrice),
    refunds: r2(t.refunds), profit: r2(t.commission + t.aviation) }))
    .sort((a, b) => a.req.localeCompare(b.req) || a.currency.localeCompare(b.currency));
}

/**
 * The review beside the file's own ticket list (the user, 26 Nov 2026: the
 * search showed AED 2,095,008.99 + SAR 7,495 for KSAML2771 and the review
 * 2,175,158.78 in riyals). The review is read from their sheet, so a ticket
 * they put in this file that we keep under another request, one they never
 * gave a refund amount for, or one in another currency moves it. Every such
 * ticket is named, and what is left is equal by construction.
 */
export interface BooksGap {
  docs: string[]; why: string;
  /** In the ticket list, by currency (refunds negative). */
  ours: Record<string, number>;
  /** In the review's net, by currency (refunds negative). */
  review: Record<string, number>;
}
export interface BooksVsReview {
  ours: Record<string, number>;
  review: Record<string, number>;
  gaps: BooksGap[];
}

const addTo = (m: Record<string, number>, c: string, v: number) => { if (Math.abs(v) >= 0.005) m[c] = r2((m[c] ?? 0) + v); };
const sameMoney = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(c => Math.abs((a[c] ?? 0) - (b[c] ?? 0)) < 0.01);

/** `books`: the file's tickets in our ledger, as its ticket list shows them (Net = amount).
 *  `sheet`: their rows, to say what became of a ticket of ours the review has no line for. */
export function booksVsReview(lines: PriceLine[], books: Ticket[], sheet: ProfitSheetRow[] = []): BooksVsReview {
  const theirs = new Map<string, ProfitSheetRow[]>();
  for (const r of sheet) for (const d of [...r.serials, ...String(r.emd || '').split(/[^0-9A-Z]+/i)]) {
    const k = ticketMatchKey(d || '');
    if (k && !isBookingRef(k)) theirs.set(k, [...(theirs.get(k) ?? []), r]);
  }
  /** Why the review has no line for one of ours. */
  const whyNoLine = (t: Ticket) => {
    const rs = theirs.get(ticketMatchKey(t.ticketNo || '')) ?? [];
    if (!rs.length) return 'In this file in ours; not on their sheet';
    const mine = reqTokensOf(withoutAvMark(t.reqNum || ''));
    const here = rs.filter(r => reqTokensOf(r.req_num).some(x => mine.includes(x)));
    if (!here.length) return `In this file in ours; on their sheet under ${[...new Set(rs.map(r => r.req_num || '(no request)'))].join(', ')}`;
    const states = [...new Set(here.map(r => (r.status || '').trim() || '(no status)'))].join(', ');
    if ((Number(t.amount) || 0) < 0 && !here.some(r => /cancel|refund/i.test(r.status || '')))
      return `Refunded in ours; their sheet still shows it ${states}`;
    if ((Number(t.amount) || 0) > 0 && !here.some(r => (r.net_cost ?? 0) > 0)) return `On their sheet with no Net Cost (${states})`;
    return `On their sheet (${states}); not compared`;
  };
  const inBooks = new Map(books.filter(t => (t.status || '').toUpperCase() !== 'FUND').map(t => [t.id, t]));
  const ours: Record<string, number> = {}, review: Record<string, number> = {};
  for (const t of inBooks.values()) addTo(ours, (t.currency || '').toUpperCase(), Number(t.amount) || 0);
  const used = new Set<string>();
  const gaps: BooksGap[] = [];
  for (const l of lines) {
    const sign = l.kind === 'SALE' ? 1 : -1;
    const r: Record<string, number> = {}, o: Record<string, number> = {};
    if (l.result !== 'NOT_COMPARED' && l.net != null) { addTo(r, l.currency, sign * l.net); addTo(review, l.currency, sign * l.net); }
    const parts = (l.ours ?? []).filter(p => !used.has(p.id));
    parts.forEach(p => used.add(p.id));
    const mine = parts.filter(p => inBooks.has(p.id)), away = parts.filter(p => !inBooks.has(p.id));
    for (const p of mine) addTo(o, p.currency, p.amount);
    if (sameMoney(o, r)) continue;
    const curs = [...new Set(mine.map(p => p.currency))].join(', ');
    const why = l.result === 'NOT_COMPARED' ? `Left out of the review: ${l.why || 'not compared'}`
      : away.length ? `On their sheet for ${l.req}; in ours under ${[...new Set(away.map(p => p.req || '(no request)'))].join(', ')}`
      : !mine.length ? `On their sheet for ${l.req}; not in this file's ticket list`
      : curs && curs !== l.currency ? `Their sheet in ${l.currency}, ours in ${curs} (converted at the peg)`
      : 'Their figure differs from ours';
    gaps.push({ docs: l.docs, why, ours: o, review: r });
  }
  for (const t of inBooks.values()) {
    if (used.has(t.id) || Math.abs(Number(t.amount) || 0) < 0.005) continue;
    gaps.push({ docs: [t.ticketNo || t.pnr || ''], why: whyNoLine(t),
      ours: { [(t.currency || '').toUpperCase()]: r2(Number(t.amount) || 0) }, review: {} });
  }
  return { ours, review, gaps };
}
