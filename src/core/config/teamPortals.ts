/**
 * Their "Portal" column, read as one of our vendors.
 *
 * Their sheet records where a ticket was bought — the portal the team sat
 * in front of — and ours records who billed us for it. Those are the same
 * fact under two names: "Ibtkar RUH" is Ibtekar, "F3" is FlyAdeal, "XY" is
 * Flynas. Until now the comparison threw the column away, so a list of
 * tickets missing from our books said nothing about where to go and find
 * them, which is the first thing anybody would ask.
 *
 * Two vendors are deliberately never offered for keying by hand. Ibtekar
 * and NSA bill us on a statement that is imported whole and settles against
 * a credit wallet; a ticket typed in beside that statement would move the
 * wallet twice and put the balance out by the price of the ticket. Their
 * rows stay on the report — a gap nobody can see is a gap nobody closes —
 * but they are held back from anything that writes, and the reason travels
 * with them.
 */

import { configuredPortals, configuredOnStatement } from './appSettings';

export interface PortalMatch {
  /** Their word, trimmed. Empty when their cell was empty. */
  portal: string;
  /** Our vendor, spelt as the ledger spells it. '' when we cannot tell. */
  source: string;
  /**
   * Our vendors this portal could mean, when it could mean more than one.
   * FlyAdeal bills from two houses and their column names neither, so the
   * choice belongs to whoever reviews the row, not to this table.
   */
  choices: string[];
  /** Kept off anything that writes a ticket, and why. */
  heldBack: boolean;
  why: string;
}

/**
 * Their portal, matched loosely: the column is typed by hand and carries
 * "Ibtkar RUH", "Ibtekar", "IATA Portal (UAE)" and "IATA portal(uae)" for
 * three of the same thing.
 */
const PORTALS: { match: RegExp; source: string; choices?: string[] }[] = [
  { match: /ibtkar|ibtekar/,              source: 'Ibtekar' },
  { match: /\bnsa\b/,                     source: 'NSA' },
  /* The ledger's own spelling, not the vendor's short name.
     Every BSP row we hold is filed under "IATA BSP"; the wallet is called
     "IATA" and reaches them by substring. Mapping this portal to the
     wallet's name put one confirmed ticket under a bare "IATA" — a second
     spelling of the same vendor, invisible to every report that groups by
     source, and 77 more were queued behind it. The ticket's source has to
     be what the ledger already calls those tickets. */
  { match: /iata|bsp/,                    source: 'IATA BSP' },
  { match: /\brts\b/,                     source: 'RTS' },
  { match: /turkish/,                     source: 'Turkish Airlines' },
  { match: /emirates/,                    source: 'Emirates' },
  { match: /riyadh\s*air/,                source: 'Riyadh Air' },
  { match: /fly\s*dubai/,                 source: 'FlyDubai' },
  { match: /air\s*arabia|\bg9\b/,         source: 'AirArabia' },
  { match: /flynas|\bxy\b/,               source: 'Flynas' },
  // Their column names the airline, not the house that bills us. Both
  // FlyAdeal accounts are real and only the reviewer knows which.
  { match: /flyadeal|\bf3\b/,             source: '', choices: ['FlyAdeal KSA', 'FlyAdeal DXB'] },
  // Bought on the airline's own site with a card. No vendor bills us at
  // all, which is a kind of vendor and needs a name to be filed under.
  { match: /a\/?l\s*website|airline\s*website|website/, source: 'Airline Website' },
];

/** What the built-in table reads, for the Settings screen to show. */
export const BUILTIN_PORTALS: { words: string; source: string }[] = [
  { words: 'Ibtkar, Ibtekar', source: 'Ibtekar' }, { words: 'NSA', source: 'NSA' },
  { words: 'IATA, BSP', source: 'IATA BSP' }, { words: 'RTS', source: 'RTS' },
  { words: 'Turkish', source: 'Turkish Airlines' }, { words: 'Emirates', source: 'Emirates' },
  { words: 'Riyadh Air', source: 'Riyadh Air' }, { words: 'Fly Dubai', source: 'FlyDubai' },
  { words: 'Air Arabia, G9', source: 'AirArabia' }, { words: 'Flynas, XY', source: 'Flynas' },
  { words: 'FlyAdeal, F3', source: 'FlyAdeal KSA or FlyAdeal DXB (the reviewer chooses)' },
  { words: 'Website, A/L website', source: 'Airline Website' },
];

/** The two that bill on a statement and settle against a wallet - unless
 *  the Settings screen says otherwise, for them or for any other vendor. */
const BUILTIN_ON_STATEMENT = new Set(['Ibtekar', 'NSA']);
export const builtinOnStatement = (source: string) => BUILTIN_ON_STATEMENT.has((source || '').trim());
const onStatement = (source: string) => configuredOnStatement(source) ?? builtinOnStatement(source);

/**
 * Does this vendor settle against a credit wallet?
 *
 * Exported so the one path that writes to the ledger without a person
 * reading the row first can check the VENDOR rather than trust a flag
 * carried along on the finding. A flag can be lost in transit; the vendor
 * name is on the row itself, and keying one of these by hand moves the
 * wallet twice.
 */
export const settlesOnStatement = (source: string) => onStatement(source);

/** Why one of them cannot be keyed in by hand. */
export const STATEMENT_WHY = () => WHY;

const WHY = 'Billed on their statement and settled against a credit wallet —'
  + ' recording it by hand would move the balance twice. It arrives when the'
  + ' statement is imported.';

/** One of their portal words. Unknown words come back as themselves. */
function one(word: string): PortalMatch {
  const portal = (word || '').trim();
  const low = portal.toLowerCase();
  // A word set on the Settings screen first: a new portal, or one read differently.
  const set = portal ? configuredPortals().find(p => low.includes(p.word.toLowerCase())) : undefined;
  const hit = set ? { source: set.source, choices: [] as string[] } : portal ? PORTALS.find(p => p.match.test(low)) : undefined;
  const source = hit?.source ?? '';
  return {
    portal,
    source,
    choices: hit?.choices ?? [],
    heldBack: onStatement(source),
    why: onStatement(source) ? WHY : '',
  };
}

/**
 * Their cell, which is sometimes two portals: "IATA Portal (UAE),RTS" when
 * a booking moved. Every part is read, the first one we recognise names the
 * vendor, and a held-back part holds the whole row back — the safe way
 * round, because the cost of holding one ticket for review is a question
 * and the cost of keying a wallet ticket twice is a wrong balance.
 */
export function portalSource(cell: string): PortalMatch {
  const parts = (cell || '').split(/[,;/]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { portal: '', source: '', choices: [], heldBack: false, why: '' };
  const all = parts.map(one);
  const named = all.find(p => p.source || p.choices.length) ?? all[0];
  const held = all.find(p => p.heldBack);
  return {
    portal: all.map(p => p.portal).join(', '),
    source: named.source,
    choices: named.choices,
    heldBack: !!held,
    why: held?.why ?? '',
  };
}

/** What to show a reader: our vendor when we know it, their word when not. */
export function issuedFrom(cell: string): string {
  const m = portalSource(cell);
  if (m.source) return m.source;
  if (m.choices.length) return m.choices.join(' or ');
  return m.portal;
}
