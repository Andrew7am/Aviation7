/**
 * A ticket's history, and what a refund at the end of it pays back.
 *
 * A refund names one document, and 27 of the 363 on the BSP billing files
 * name a reissue. A reissue's own value is usually the change fee: 20.00 on
 * a document refunded for 48,890, because the 51,550 sits on the original.
 * Measured against the document it names, that refund is money coming back
 * that was never paid; measured against the chain, it is a refund less a
 * penalty.
 *
 * And a reissue that moved no money never becomes a ledger row — 42 of the
 * 192 on the files. Two refunds name exactly such a reissue, with the
 * original sitting in the books. Walking back through the chain finds it.
 */
import { chainIndex, chainOf, heldInChain } from '../src/core/helpers/ticketChain';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. A refund of a reissue');
{
  // The real one: 51,550 issued, reissued for a 20.00 fee, refunded 48,890.
  const idx = chainIndex([{ ticketNo: '5512129174', replacedTicket: '5512129165', fee: 20 }]);
  const c = chainOf('5512129174', idx);
  check('the chain, oldest first', c.documents, ['5512129165', '5512129174']);
  check('the original carries the fare', c.original, '5512129165');
  check('the reissue is where the refund sits', c.position, 1);
}

console.log('\n2. More than one reissue');
{
  // 3,500 -> 20 -> 40, refunded 2,730.
  const idx = chainIndex([
    { ticketNo: '5512760089', replacedTicket: '5512760066' },
    { ticketNo: '5512760095', replacedTicket: '5512760089' },
  ]);
  check('from the last', chainOf('5512760095', idx).documents,
        ['5512760066', '5512760089', '5512760095']);
  check('from the middle, the whole chain', chainOf('5512760089', idx).documents,
        ['5512760066', '5512760089', '5512760095']);
  check('from the original, forward', chainOf('5512760066', idx).latest, '5512760095');
}

console.log('\n3. A ticket never exchanged is a chain of one');
{
  const c = chainOf('5513373350', chainIndex([]));
  check('itself', c.documents, ['5513373350']);
  check('its own original', c.original, '5513373350');
}

console.log('\n4. Found through a reissue the books never kept');
{
  /* An even exchange moves no money and is not a ledger row. The refund names
     it; the original is in the books. The two real cases. */
  const idx = chainIndex([
    { ticketNo: '5512369248', replacedTicket: '5512369158', fee: 0 },
    { ticketNo: '4126662045', replacedTicket: '2540225901', fee: 0 },
  ]);
  const held = new Set(['5512369158', '2540225901']);
  check('the BSP one', heldInChain('5512369248', idx, held), '5512369158');
  check('the one first issued by Turkish', heldInChain('4126662045', idx, held), '2540225901');
  check('the document itself wins when it is held',
        heldInChain('5512369248', idx, new Set(['5512369248', '5512369158'])), '5512369248');
  check('nothing held is nothing', heldInChain('5512369248', idx, new Set()), null);
}

console.log('\n5. Punctuation is not identity');
{
  const idx = chainIndex([{ ticketNo: '065-5512129174', replacedTicket: '0655512129165' }]);
  check('prefixed edges still link', chainOf('5512129174', idx).original, '5512129165');
}

console.log('\n6. Bad data cannot hang the screen');
{
  /* A reissue recorded as replacing its own descendant would walk for ever.
     The walk refuses to revisit a document instead. */
  const idx = chainIndex([
    { ticketNo: 'A0000000001', replacedTicket: 'A0000000002' },
    { ticketNo: 'A0000000002', replacedTicket: 'A0000000001' },
  ]);
  const c = chainOf('0000000001', idx);
  check('it returns', Array.isArray(c.documents), true);
  check('and visits each document once', new Set(c.documents).size, c.documents.length);

  // A document that "replaces itself" is ignored rather than looped on.
  const self = chainIndex([{ ticketNo: '5513373350', replacedTicket: '5513373350' }]);
  check('a self-reference is no edge', chainOf('5513373350', self).documents, ['5513373350']);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
