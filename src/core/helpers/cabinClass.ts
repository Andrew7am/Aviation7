/**
 * The cabin a ticket was sold in.
 *
 * Airlines name their cabins whatever they like — Main Cabin, Prestige,
 * Business Elite, fly+, GO Basic — and one journey can run through several of
 * them. This reduces that to the four cabins the trade actually settles in,
 * and refuses to guess at the rest.
 *
 * The words are what decide it, not a table of brand names. "Business Elite"
 * and "Business; Prestige" both say business; "Economy - Smart" and "Economy;
 * Main Cabin" both say economy. A name that states no cabin at all — fly+,
 * flyMax, Guest Basic, Premium Class — is left unknown rather than assigned to
 * whichever cabin seems likeliest, because a wrong cabin in a sales report is
 * worse than a blank one, and the raw text is kept so it can be named later.
 */

export type Cabin = 'FIRST' | 'BUSINESS' | 'PREMIUM_ECONOMY' | 'ECONOMY' | '';

/** Highest first — a journey is reported by the best cabin it touched. */
export const CABIN_RANK: Cabin[] = ['FIRST', 'BUSINESS', 'PREMIUM_ECONOMY', 'ECONOMY'];

export const CABIN_LABEL: Record<Exclude<Cabin, ''>, string> = {
  FIRST:           'First',
  BUSINESS:        'Business',
  PREMIUM_ECONOMY: 'Premium Economy',
  ECONOMY:         'Economy',
};

/**
 * Fare brands the agency has told us the cabin for.
 *
 * Kept apart from the word-reading below on purpose. Reading "Business Elite"
 * as business is the words doing the work; knowing that flynas's fly+ is an
 * economy bundle is knowledge from outside the text, and the only safe source
 * for it is the people who sell the tickets. Nothing is added here on a
 * reasonable guess — an unrecognised brand stays blank and shows on screen as
 * itself until someone says what it is.
 */
const CONFIRMED_BRANDS: Record<string, Cabin> = {
  'fly+': 'ECONOMY',   // flynas — confirmed by the agency
};

/** What one cabin name says, if anything. */
function readOne(text: string): Cabin {
  const s = text.toLowerCase();
  if (/couldn'?t be determined|not determined|unknown/.test(s)) return '';
  const brand = CONFIRMED_BRANDS[s];
  if (brand) return brand;
  if (/\bfirst\b/.test(s)) return 'FIRST';
  if (/\bbusiness\b/.test(s)) return 'BUSINESS';
  // Both orders appear in the data, and "premium" alone is not enough: a
  // "Premium Class" could be either premium economy or business.
  if (/premium\s+economy|economy\s+premium/.test(s)) return 'PREMIUM_ECONOMY';
  if (/\beconomy\b|\bmain cabin\b|\bcoach\b/.test(s)) return 'ECONOMY';
  return '';
}

/**
 * The cabin for a whole journey, from however the source wrote it.
 *
 * A journey listed as "Economy; Business" flew both, and is reported as
 * Business: the ticket was sold with a business leg on it, and calling the
 * whole thing economy would lose the part that cost the money. The raw text
 * stays alongside so the mixed journey is still visible.
 */
export function toCabin(raw: string | undefined | null): Cabin {
  const text = (raw || '').trim();
  if (!text) return '';
  const parts = text.split(/[;,/|]+/).map(p => p.trim()).filter(Boolean);
  const found = (parts.length ? parts : [text]).map(readOne).filter(Boolean) as Cabin[];
  if (!found.length) return '';
  for (const c of CABIN_RANK) if (found.includes(c)) return c;
  return '';
}

/** Did the source say something this could not read? Those are worth showing
 *  to whoever can name them, rather than silently counting as unknown. */
export function isUnreadableCabin(raw: string | undefined | null): boolean {
  const text = (raw || '').trim();
  if (!text) return false;
  if (/couldn'?t be determined|not determined|unknown/i.test(text)) return false;
  return toCabin(text) === '';
}

/** A journey that ran through more than one cabin. */
export function isMixedCabin(raw: string | undefined | null): boolean {
  const parts = (raw || '').split(/[;,/|]+/).map(p => readOne(p.trim())).filter(Boolean);
  return new Set(parts).size > 1;
}
