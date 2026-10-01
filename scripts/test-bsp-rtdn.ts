/**
 * The ticket a BSP refund refunds.
 *
 * BSP prints a refund as a document line of its own, and the line after it
 * names what it refunds:
 *
 *     065 RFND 0079527503 01APR26 ... -2,600.00
 *         +RTDN: 2195858830 1000 0.00
 *
 * RTDN is "Related Ticket Document Number". The parser read the RFND line
 * and never the RTDN beneath it, so fourteen refund applications with a
 * document number of their own sat in the ledger tied to nothing — one of
 * them under a request somebody typed as "REFNDAPPLICATION", because they
 * could see it was a refund and not what it refunded.
 *
 * Read across all 37 billing files: 363 refunds, 363 related tickets, none
 * missing, none disagreeing with an independent extraction.
 */
import { rtdnAfter } from '../src/core/parsers/BSPInvoiceParser';
import { runParser } from '../src/core/parsers';
import { invoiceGrid, txn } from './helpers/bspFixture';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. A refund application names its ticket on the next line');
{
  const lines = [
    '065 RFND 0079527503 01APR26 I CA -2,600.00 -2,600.00 0.00 0.00 0.00 0.00 0.00 -2,600.00',
    '+RTDN: 2195858830 1000 0.00',
  ];
  check('the related ticket', rtdnAfter(lines, 0), '2195858830');
}

console.log('\n2. However many lines of tax sit between them');
{
  /* A real refund of 9,530 prints seven lines of tax breakdown before its
     RTDN. A fixed window of lines found the related ticket on 105 of 363
     refunds; searching to the next document found all 363. */
  const lines = [
    '065 RFND 5512129172 19MAR26 I -9,530.00 -8,470.00 540.00 CP -8,470.00 0.00 -9,530.00',
    'CA -50.00 FR -200.00 YQ',
    '-60.00 FR -900.00 YR',
    '-160.00 IO',
    '-70.00 O4',
    '-150.00 QX',
    '-10.00 T2',
    '+RTDN: 5512129172 1200 0.00',
  ];
  check('found seven lines down', rtdnAfter(lines, 0), '5512129172');
}

console.log('\n3. It stops at the next document');
{
  /* A refund that names no ticket must not borrow the next document's
     RTDN — that would tie the refund to somebody else's ticket. */
  const lines = [
    '065 RFND 5511323127 05FEB26 I CA -1,000.00 -1,000.00',
    '-10.00 T2',
    '065 RFND 5511323152 05FEB26 I CA -2,000.00 -2,000.00',
    '+RTDN: 5511323152 1000 0.00',
  ];
  check('the first names nothing', rtdnAfter(lines, 0), '');
  check('the second names its own', rtdnAfter(lines, 2), '5511323152');
}

console.log('\n4. "RA" on these pages is a tax, not a refund application');
{
  const lines = [
    '065 RFND 5512129174 19MAR26 I -48,890.00 -45,290.00 -2,820.00 YR',
    '10.00 RA',
    '50.00 RA',
    '+RTDN: 5512129173 1230 0.00',
  ];
  check('the tax lines are passed over', rtdnAfter(lines, 0), '5512129173');
}

console.log('\n5. The last document in the file');
{
  check('an RTDN at the very end is still read',
        rtdnAfter(['065 RFND 1930576269 31AUG26 I* CA -64,350.00', '+RTDN: 1930576269 1000 0.00'], 0),
        '1930576269');
  check('and none is none', rtdnAfter(['065 RFND 1930576269 31AUG26 I* CA -64,350.00'], 0), '');
}

console.log('\n6. A debit or credit memo names its ticket the same way');
{
  /* The real ones, from the December, March and April billing files:
       065 ADMA 6206503067 03DEC25 ... 170.00          +RTDN: 6075549430
       109 ADMA 6210900650 18MAR26 ... 104.36          +RTDN: 5512129133
       125 ACMA 0820147238 12MAR26 ... -30,699.00      +RTDN: 5512129182 */
  const parsed = (trnc: string, doc: string, money: Record<string, number>, rtdn?: string) => {
    const body: any[] = [trnc.startsWith('AC') ? '*** CREDIT MEMOS' : '*** DEBIT MEMOS',
      txn({ air: '065', trnc, doc, date: '03DEC25', ...money })];
    if (rtdn) body.push(`+RTDN: ${rtdn} 0000 0.00`);
    return runParser(invoiceGrid(body), undefined, 'AED', 'invoice.pdf').rows[0];
  };
  const adm = parsed('ADMA', '6206503067', { txn: 170, fare: 170, payable: 170 }, '6075549430');
  check('the ADM is an ADM', adm?.status, 'ADM');
  check('and names the ticket it charges for', adm?.relatedTicket, '6075549430');
  const recall = parsed('ADMA', '6210900650', { txn: 0, stdAmt: -104.36, suppAmt: 0, payable: 104.36 }, '5512129133');
  check('a commission recall too', recall?.relatedTicket, '5512129133');
  const acm = parsed('ACMA', '0820147238', { txn: -30699, fare: -28679, payable: -30699 }, '5512129182');
  check('a credit memo names the ticket it credits', [acm?.status, acm?.relatedTicket], ['ACM', '5512129182']);
  check('a memo that names nothing names nothing',
        parsed('ACMA', '8206500104', { txn: -2074.06, fare: -2074.06, payable: -2074.06 })?.relatedTicket, undefined);
  const fee = parsed('SPDR', '6000083998', { txn: 22.08, fare: 22.08, payable: 22.08 });
  check('a BSP fee has no ticket', fee?.relatedTicket, undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
