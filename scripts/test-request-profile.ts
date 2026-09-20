/**
 * A request read as one thing.
 *
 * The rule these pin is the one that decides whether the screen is worth
 * having: the profile reads the WHOLE request, never the rows that happen to
 * be on screen. A view filtered to Not Closed contains only open rows, and
 * from inside it a request with seventy-two closed rows and two open ones is
 * indistinguishable from one with two rows - so the part-closed warning, the
 * only finding here a person cannot make by eye, would never fire.
 */
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2),
  ticketNo: '5512369334', pnr: '', passengerName: '', airlineCode: '065',
  route: '', source: 'IATA BSP', date: '2026-04-08', amount: 1000,
  totalDoc: 1000, commission: 0, reqNum: 'KSAML1452', status: 'ISSUE',
  currency: 'AED', isDuplicate: false, closed: true, userId: 'u', ...o,
});

/** The profile's arithmetic, kept in step with RequestProfile.tsx. */
function profile(reqNum: string, tickets: Ticket[]) {
  const key = reqNum.trim().toUpperCase();
  const rows = tickets.filter(t => (t.reqNum || '').trim().toUpperCase() === key
    && (t.status || '').toUpperCase() !== 'FUND');
  const closed = rows.filter(t => t.closed);
  const open = rows.filter(t => !t.closed);
  const money = (rs: Ticket[]) => rs.reduce<Record<string, number>>((m, t) => {
    const c = t.currency || 'SAR';
    m[c] = Math.round(((m[c] ?? 0) + (t.amount || 0)) * 100) / 100;
    return m;
  }, {});
  return {
    rows: rows.length,
    closed: closed.length,
    open: open.length,
    mixed: closed.length > 0 && open.length > 0,
    allClosed: rows.length > 0 && open.length === 0,
    net: money(rows),
    openValue: money(open),
    sources: [...new Set(rows.map(t => t.source).filter(Boolean))],
    firstIsOpen: [...rows].sort((a, b) =>
      Number(!!a.closed) - Number(!!b.closed)
      || (a.date || '').localeCompare(b.date || ''))[0],
  };
}

console.log('\n1. Two open rows hiding among seventy-two closed');
{
  const rows: Ticket[] = [
    ...Array.from({ length: 72 }, (_, i) => tkt({ ticketNo: `A${i}`, closed: true, amount: 100 })),
    tkt({ ticketNo: 'OPEN1', closed: false, amount: 22290 }),
    tkt({ ticketNo: 'OPEN2', closed: false, amount: 20 }),
  ];
  const p = profile('KSAML1452', rows);
  check('every row is read',        p.rows, 74);
  check('the split is named',       [p.closed, p.open], [72, 2]);
  check('it is flagged part closed', p.mixed, true);
  check('with what is outstanding',  p.openValue, { AED: 22310 });
  check('and an open row leads',     p.firstIsOpen.closed, false);
}

console.log('\n2. The filtered view is exactly what must NOT be passed in');
{
  // The fault this guards: hand the profile only the not-closed rows and it
  // reports a tidy, fully open request - the opposite of the truth.
  const all: Ticket[] = [
    ...Array.from({ length: 72 }, (_, i) => tkt({ ticketNo: `A${i}`, closed: true })),
    tkt({ ticketNo: 'OPEN1', closed: false }),
    tkt({ ticketNo: 'OPEN2', closed: false }),
  ];
  const onlyOpen = all.filter(t => !t.closed);
  check('given everything, it warns',     profile('KSAML1452', all).mixed, true);
  check('given the filtered slice, it cannot',
        profile('KSAML1452', onlyOpen).mixed, false);
  check('and would call it wholly open',
        profile('KSAML1452', onlyOpen).allClosed, false);
}

console.log('\n3. A finished request says so');
{
  const p = profile('UAEVP512', [
    tkt({ reqNum: 'UAEVP512', closed: true }), tkt({ reqNum: 'UAEVP512', closed: true }),
  ]);
  check('nothing is outstanding', p.open, 0);
  check('it reads as finished',   p.allClosed, true);
  check('and is not flagged',     p.mixed, false);
}

console.log('\n4. Currencies are never added together');
{
  const p = profile('KSAML1452', [
    tkt({ amount: 22290, currency: 'AED' }),
    tkt({ amount: 47180, currency: 'SAR' }),
    tkt({ amount: -47180, currency: 'SAR', status: 'REFUND' }),
  ]);
  check('each stands on its own', p.net, { AED: 22290, SAR: 0 });
}

console.log('\n5. One request, several suppliers');
{
  const p = profile('KSAML1452', [
    tkt({ source: 'IATA BSP' }), tkt({ source: 'NSA' }), tkt({ source: 'RTS' }),
    tkt({ source: 'NSA' }),
  ]);
  check('every supplier is named', p.sources.sort(), ['IATA BSP', 'NSA', 'RTS']);
}

console.log('\n6. Only this request, and case does not matter');
{
  const rows = [
    tkt({ reqNum: 'KSAML1452' }),
    tkt({ reqNum: 'ksaml1452' }),   // the ledger holds both spellings
    tkt({ reqNum: 'KSAML1451' }),   // a neighbour, not this one
  ];
  check('both spellings are one request', profile('KSAML1452', rows).rows, 2);
  check('the neighbour is left out',      profile('KSAML1451', rows).rows, 1);
}

console.log('\n7. A balance payment is not part of a request');
{
  const p = profile('KSAML1452', [
    tkt({ amount: 1000 }),
    tkt({ amount: 50000, status: 'FUND' }),
  ]);
  check('FUND rows are excluded', p.rows, 1);
  check('and not counted',        p.net, { AED: 1000 });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
