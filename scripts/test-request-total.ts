/**
 * A request's net total, as a file is closed, for the email when it reaches
 * its figure (KSAML2771 at 2,000,000 AED).
 */
import { requestNet, sheetOnlySerials } from '../src/core/helpers/requestTotal';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const bk = (ticketNo: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ ticketNo, status: amount < 0 ? 'REFUND' : 'ISSUE', amount, totalDoc: Math.abs(amount), currency: 'AED', reqNum: 'KSAML2771', ...extra });
const sh = (serial: string, net_cost: number, extra: Record<string, unknown> = {}) =>
  ({ serials: serial ? [serial] : [], status: 'Issued', net_cost, currency: 'AED', req_num: 'KSAML2771', ...extra });

const r = requestNet('KSAML2771', 'AED', [
  bk('5513658300', 16670), bk('5513658301', 16670), bk('5513658301', -16670),
  bk('5513658304', 9510.2, { totalDoc: 9650, commission: 139.8 }), bk('5513658305', 30, { status: 'ADM' }), bk('5513658306', 0, { status: 'VOID' }),
  bk('5513658307', 500, { status: 'FUND' }),
  bk('1949933400', 280, { status: 'EMDS' }), bk('5513658302', 5000, { reqNum: 'KSAML2770' }),
  bk('5513658303', 1000, { reqNum: 'KSAML2771-FIT' }), bk('4862000001', 900, { currency: 'SAR' }),
], [
  sh('5513658300', 17000), sh('5513658399', 3000), sh('5513658398', 3000, { status: 'On Hold' }), sh('5513658397', 3000, { status: 'Void' }),
  sh('5513658396', 440, { status: 'Reissue' }), sh('', 9000),
]);
check('at cost, net of commission, refunds off, ADMs on; FUND and voids add nothing', r.fromBooks, 16670 + 16670 - 16670 + 9510.2 + 30 + 280 + 1000);
check('the refunds taken off', r.refunded, 16670);
check('another request stays out, the same request written longer stays in, riyals stay out', r.docs, 8);
check('their issued rows not in our books count; On Hold, Void and unnumbered rows do not', r.fromSheet, 3440);
check('the total', r.total, 30930.2);

// KSAML2771's YC24LS: their sheet still says Issued, the supplier voided all three.
const books = [bk('5513658379', 2271)];
const sheet = [{ serials: ['5513658381', '5513658384', '5513658387'], status: 'Issued', net_cost: 6260, currency: 'AED', req_num: 'KSAML2771' }];
check('their numbers not in our books are the ones looked up', sheetOnlySerials('KSAML2771', books, sheet), ['5513658381', '5513658384', '5513658387']);
check('a row voided with the supplier is not issued', requestNet('KSAML2771', 'AED', books, sheet, ['5513658381', '5513658384', '5513658387']).fromSheet, 0);
check('one of three still live keeps the row', requestNet('KSAML2771', 'AED', books, sheet, ['5513658381']).fromSheet, 6260);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
