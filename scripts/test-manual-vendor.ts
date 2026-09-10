/**
 * The seam a person crosses when they add a vendor themselves: a hand-typed
 * ticket, and a report format taught through Settings rather than shipped as
 * code.
 *
 * Every case here is one that was actually wrong. An accounting negative read
 * as a sale, a cancelled document charged as a live one, and an airline code
 * scavenged from a serial's own leading digits all imported quietly and moved
 * a balance the wrong way — none of them raised an error at the time.
 */
import Papa from 'papaparse';
import { runParser } from '../src/core/parsers';
import { headerFingerprint, LearnedProfile } from '../src/core/ai/learnedProfile';
import { splitTicketNo } from '../src/core/helpers/ticketIdentity';
import { num } from '../src/core/parsers/shared';

let failed = 0, passed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const parse = (csv: string) => Papa.parse(csv.trim(), { skipEmptyLines: true }).data as string[][];
const profile = (name: string, header: string, columns: any, rules: any = { refund: 'negative_amount' }): LearnedProfile => ({
  vendorName: name, fingerprint: headerFingerprint(header.split(',')),
  isLCC: !columns.ticket, headers: header.split(','), columns, rules, origin: 'manual',
});

console.log('\n1. A negative written the way accountants write it');
{
  check('(500.00) is negative five hundred', num('(500.00)'), -500);
  check('SAR (500.00) too',                  num('SAR (500.00)'), -500);
  check('a trailing minus is negative',      num('500.00-'), -500);
  check('a leading minus still is',          num('-500.00'), -500);
  check('a plain figure is untouched',       num('500.00'), 500);
  check('thousands separators survive',      num('1,234.56'), 1234.56);
  check('a currency prefix survives',        num('SAR 300.00'), 300);
  check('a lone dash is not a number',       num('-'), 0);
  check('blank is zero',                     num(''), 0);
}

console.log('\n2. A taught format carries those through to the ledger figure');
{
  const H = 'Ref,Amount,Date';
  const p = profile('Paren Co', H, { pnr: 'Ref', amount: 'Amount', date: 'Date' });
  const r = runParser(parse(`${H}\nBK1,(500.00),01/09/2026`), undefined, 'SAR', undefined, [p]);
  check('a parenthesised row imports as a refund', r.rows[0]?.status, 'REFUND');
  check('and carries a negative amount',           r.rows[0]?.amount, -500);
}

console.log('\n3. A cancelled document settles at zero');
{
  const H = 'Ref,Amount,Status,Date';
  const p = profile('Void Co', H, { pnr: 'Ref', amount: 'Amount', status: 'Status', date: 'Date' },
                    { refund: 'status_column' });
  const r = runParser(parse(`${H}\nBK1,900.00,VOID,01/09/2026`), undefined, 'SAR', undefined, [p]);
  check('VOID is read as VOID',    r.rows[0]?.status, 'VOID');
  check('and is worth nothing',    r.rows[0]?.amount, 0);
}

console.log('\n4. A hand-typed ticket does not invent an airline');
{
  const bare = splitTicketNo('4861806209', '');
  check('a bare serial yields no airline code', bare.airlineCode, '');
  check('and keeps its number intact',          bare.ticketNo, '4861806209');

  const joined = splitTicketNo('0655513059068', '');
  check('a 13-digit document does split',       joined.airlineCode, '065');
  check('into code and serial',                 joined.ticketNo, '5513059068');

  const stated = splitTicketNo('4861806209', '065');
  check('a stated code is honoured',            stated.airlineCode, '065');

  const junk = splitTicketNo('4861806209', 'xx');
  check('a code that is not one is ignored',    junk.airlineCode, '');
}

console.log('\n5. A format taught on a header row no heuristic would pick');
{
  const H = 'Ref,Amount,Date';
  const p = profile('Deep Co', H, { pnr: 'Ref', amount: 'Amount', date: 'Date' });
  const csv = [
    'SOME VENDOR LLC', 'PO Box 1', 'Riyadh', 'VAT 30000', 'Statement', 'Period,x',
    H, 'BK1,640.00,01/09/2026',
  ].join('\n');
  const r = runParser(parse(csv), undefined, 'SAR', undefined, [p]);
  check('the header is still found under a preamble', r.rows.length, 1);
  check('and the row is read',                        r.rows[0]?.amount, 640);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
