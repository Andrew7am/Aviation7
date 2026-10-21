/**
 * Emirates' weekly IATA limit: what counts toward the 300,000 AED, and when
 * the warning is raised.
 */
import { EMIRATES_IATA, limitUse, limitWeek, localDate } from '../src/core/helpers/airlineLimit';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const bk = (ticketNo: string, date: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ ticketNo, source: 'IATA BSP', airlineCode: '176', status: amount < 0 ? 'REFUND' : 'ISSUE', date, amount, totalDoc: Math.abs(amount), ...extra });
const sh = (serial: string, issued_at: string, net_cost: number, extra: Record<string, unknown> = {}) =>
  ({ serials: serial ? [serial] : [], status: 'Issued', portal: 'IATA Portal (UAE)', airline: 'Emirates', net_cost, issued_at, ...extra });
const cfg = EMIRATES_IATA;

console.log('\n1. The week runs Wednesday to Tuesday from 21 Oct');
check('the first day', limitWeek('2026-10-21', cfg.weekFrom), { from: '2026-10-21', to: '2026-10-27' });
check('its last day', limitWeek('2026-10-27', cfg.weekFrom), { from: '2026-10-21', to: '2026-10-27' });
check('the next Wednesday starts the next week', limitWeek('2026-10-28', cfg.weekFrom), { from: '2026-10-28', to: '2026-11-03' });
check('a ticket at 22:00 UTC is the next local day', localDate('2026-10-20T22:00:00.000Z'), '2026-10-21');

console.log('\n2. What counts');
{
  const u = limitUse(cfg, [
    bk('5513658300', '2026-10-21', 100_000),
    bk('5513658301', '2026-10-22', 50_000, { status: 'EMDS' }),
    bk('5513658302', '2026-10-23', -40_000),
    bk('5513658303', '2026-10-20', 90_000),
    bk('5513658304', '2026-10-22', 70_000, { airlineCode: '065' }),
    bk('5513658305', '2026-10-22', 70_000, { source: 'Ibtekar' }),
  ], [], '2026-10-23');
  check('tickets and EMDs of the week count, at full fare', u.fromBooks, 150_000);
  check('a refund gives nothing back; last week, other airlines and other suppliers stay out', u.used, 150_000);
}
{
  const u = limitUse(cfg, [bk('5513658310', '2026-10-21', 100_000)], [
    sh('5513658310', '2026-10-21T08:00:00Z', 101_000),
    sh('5513658311', '2026-10-22T08:00:00Z', 60_000),
    sh('5513658312', '2026-10-22T08:00:00Z', 9_000, { status: 'On Hold' }),
    sh('5513658313', '2026-10-22T08:00:00Z', 9_000, { status: 'Void' }),
    sh('5513658314', '2026-10-22T08:00:00Z', 9_000, { portal: 'EK NDC' }),
    sh('5513658315', '2026-10-22T08:00:00Z', 9_000, { airline: 'Saudia' }),
    sh('5513658316', '2026-10-20T10:00:00Z', 9_000),
    sh('5513658317', '2026-10-22T08:00:00Z', 2_000, { status: 'Reissue' }),
  ], '2026-10-23');
  check('their row for a ticket in our books gives way to ours', u.fromBooks, 100_000);
  check('their issued rows not yet in a report count', u.fromSheet, 62_000);
  check('documents counted', u.docs, 3);
}

console.log('\n3. The warning');
check('below 290,000: nothing', limitUse(cfg, [bk('1', '2026-10-21', 289_999)], [], '2026-10-21').level, 'OK');
check('at 290,000: warn', limitUse(cfg, [bk('1', '2026-10-21', 290_000)], [], '2026-10-21').level, 'WARN');
check('at 300,000: over', limitUse(cfg, [bk('1', '2026-10-21', 300_000)], [], '2026-10-21').level, 'OVER');
check('what is left', limitUse(cfg, [bk('1', '2026-10-21', 291_500)], [], '2026-10-21').left, 8_500);
check('a new week starts from nothing', limitUse(cfg, [bk('1', '2026-10-21', 295_000)], [], '2026-10-28').level, 'OK');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
