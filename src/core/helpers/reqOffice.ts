/**
 * Which office raised the request.
 *
 * The req number carries it in its prefix, as the agency writes them:
 *
 *   Dubai   UAEVP, UAECO, UAEMLMI, UAEC, UAEFM, and the bare REQ series
 *   Saudi   SA, and everything under KSA — KSAML, KSACO, KSAMLMI, KSAFM, KSAMI
 *   Egypt   EGPML
 *
 * KSA is tested before SA, and both as prefixes rather than as substrings, so
 * KSAML1445 is Saudi once rather than Saudi twice, and a req number that
 * merely CONTAINS "sa" somewhere is not swept in.
 *
 * Everything else returns '' rather than being forced into the nearest office.
 * Seventy-odd rows in this ledger have a req number that is not an office code
 * at all — ADM, ACM, VOID, CANXX, REFUNDED, CREDIT MEMO, COMPANY EXPENSE, and
 * a few people's names — and quietly filing those under a country would be
 * inventing a fact about where the work was done.
 */

export type Office = 'DUBAI' | 'SAUDI' | 'EGYPT' | '';

export const OFFICE_LABEL: Record<Exclude<Office, ''>, string> = {
  DUBAI: 'Dubai',
  SAUDI: 'Saudi',
  EGYPT: 'Egypt',
};

/** Prefixes in the order they must be tested: the longer, more specific ones
 *  first, so KSA never falls through to SA.
 *
 *  DXB is Dubai's airport code and RQE is REQ typed with two letters
 *  transposed; the agency confirmed both belong to Dubai. */
const RULES: [string[], Exclude<Office, ''>][] = [
  [['KSA'], 'SAUDI'],
  [['UAE', 'REQ', 'RQE', 'DXB'], 'DUBAI'],
  [['EGP'], 'EGYPT'],
  [['SA'], 'SAUDI'],
];

/**
 * The same codes, but written somewhere other than the front.
 *
 * "EXPENSE(UAE)" names its office in brackets at the end. The code has to
 * stand alone — bounded by something that is not a letter — so this reads that
 * one and does not sweep in a req number that merely contains the letters, the
 * way a plain substring search would make MISA123 Saudi.
 */
const TOKEN_RULES: [string[], Exclude<Office, ''>][] = [
  [['KSA'], 'SAUDI'],
  [['UAE', 'DXB'], 'DUBAI'],
  [['EGP'], 'EGYPT'],
];

export function classifyOffice(reqNum: string | undefined | null): Office {
  const s = (reqNum || '').trim().toUpperCase();
  if (!s) return '';
  for (const [prefixes, office] of RULES) {
    if (prefixes.some(p => s.startsWith(p))) return office;
  }
  for (const [codes, office] of TOKEN_RULES) {
    if (codes.some(code => new RegExp(`(^|[^A-Z])${code}([^A-Z]|$)`).test(s))) return office;
  }
  return '';
}
