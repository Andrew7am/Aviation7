/**
 * Reading the office out of a req number.
 *
 * Every string here is one this ledger actually contains.
 *
 * Run: npx tsx scripts/test-req-office.ts
 */
import { classifyOffice, OFFICE_LABEL } from '../src/core/helpers/reqOffice';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

console.log('\n1. Dubai — the UAE series and the bare REQ series');
for (const r of ['UAEVP105', 'UAECO98', 'UAEMLMI1655', 'UAEC125', 'UAEFM2296',
                 'REQ10119', 'REQ9932-2']) {
  check(r, classifyOffice(r), 'DUBAI');
}

console.log('\n2. Saudi — SA and everything under KSA');
for (const r of ['SA0293', 'SA998', 'KSAML644', 'KSACO363', 'KSAMLMI1446-SA1196',
                 'KSAFM2440', 'KSAMI1643']) {
  check(r, classifyOffice(r), 'SAUDI');
}

console.log('\n3. KSA must not be read as SA twice, nor fall to the wrong office');
// The rule that matters: a longer prefix is tested first. If SA were checked
// before KSA the answer would still be SAUDI here by luck, so the real test is
// that KSAML107-SA1145 lands once and lands right.
check('KSAML107-SA1145', classifyOffice('KSAML107-SA1145'), 'SAUDI');
check('a bare KSA', classifyOffice('KSA'), 'SAUDI');

console.log('\n4. Egypt');
check('EGPML1909', classifyOffice('EGPML1909'), 'EGYPT');

console.log('\n5. Prefix, never substring');
// "MISA123" contains SA but does not start with it; nothing should claim it.
check('MISA123 is not Saudi', classifyOffice('MISA123'), '');
check('XUAE9 is not Dubai', classifyOffice('XUAE9'), '');
check('A-REQ-5 is not Dubai', classifyOffice('A-REQ-5'), '');

console.log('\n6. Everything that is not an office code stays unclassified');
for (const r of ['ADM', 'ADM-SHYMAA', 'ACM', 'VOID', 'CANXX', 'REFUNDED',
                 'REFNDAPPLICATION', 'CREDIT MEMO', 'COMPANY EXPENSE',
                 'COMPANYEXPENSE', 'COMEXP', 'COM EXP', 'GIHANEXPENSE',
                 'LEC&WLS', 'VIP', 'BOSS', 'MR.KHALED', '1', 'DXB', 'DXB-KHALED',
                 'RQE11660', 'EXPENSE(UAE)']) {
  check(`${r} -> unclassified`, classifyOffice(r), '');
}

console.log('\n7. Case and whitespace do not matter');
check('lowercase uaevp1', classifyOffice('uaevp1'), 'DUBAI');
check('  ksaml5  ', classifyOffice('  ksaml5  '), 'SAUDI');
check('empty', classifyOffice(''), '');
check('undefined', classifyOffice(undefined), '');

console.log('\n8. Every office has a label');
check('three labels', Object.keys(OFFICE_LABEL).sort(), ['DUBAI', 'EGYPT', 'SAUDI']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
