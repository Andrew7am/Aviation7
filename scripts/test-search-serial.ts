/**
 * A ticket searched the way their sheet writes it: with its airline code,
 * dashed, spaced or run together. Our books keep the ten-digit serial.
 *
 *   npx tsx scripts/test-search-serial.ts
 */
import { searchSerial, matchesSearch } from '../src/core/helpers/ticketIdentity';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\nA. The serial a search names');
check('dashed', searchSerial('256-8654543453'), '8654543453');
check('run together', searchSerial('2568654543453'), '8654543453');
check('spaced', searchSerial('256 8654543453'), '8654543453');
check('dash with spaces round it', searchSerial(' 256 - 8654543453 '), '8654543453');
check('a conjunction finds its first ticket', searchSerial('065-5513059068-69'), '5513059068');
check('the serial alone is searched as typed', searchSerial('8654543453'), '');
check('part of a number is searched as typed', searchSerial('256-86545'), '');
check('a PNR is not a ticket', searchSerial('ZHYB89'), '');
check('a request is not a ticket', searchSerial('KSAML2343'), '');

console.log('\nB. Our row, kept as the serial, is found every way');
const ours = '8654543453 KSAML2343 TAALTC Turkish Airlines AHMED SAADEDDIN';
for (const q of ['256-8654543453', '2568654543453', '256 8654543453', '8654543453', '86545434', 'saadeddin', 'ksaml2343'])
  check(`"${q}"`, matchesSearch(ours, q), true);
check('another airline\'s ticket is not', matchesSearch(ours, '256-8654543454'), false);

console.log('\nC. Their cell, kept as they typed it, is found every way');
for (const cell of ['256-8654543453', '2568654543453', '256 8654543453'])
  for (const q of ['256-8654543453', '2568654543453', '8654543453'])
    check(`"${q}" in "${cell}"`, matchesSearch(cell.replace(/\s+/g, ''), q) || matchesSearch(cell, q), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
