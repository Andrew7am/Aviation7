/**
 * A date that is not a date.
 *
 * A row with no date sits in no period, cancels out of every movement, and is
 * the reason a total quietly fails to foot. The ledger screen has always let
 * an EMPTY date be filled in for that reason, and refused to let a recorded
 * one be changed — a real date comes from the document, through an import,
 * with the audit trail that carries.
 *
 * But an empty date does not always arrive empty. Three Ibtekar rows hold
 * 1970-01-01, which is what an empty value becomes when something coerces it
 * to a number and back. That is worse than blank in every way: it is not
 * missing, so nothing flags it; it sorts to the top of every list; and it
 * files the row in a period fifty-six years before the business existed.
 *
 * So the test is not "is the string empty" but "does this say when". The
 * epochs below say nothing — they are what emptiness looks like after a
 * round trip through a spreadsheet or a Unix timestamp — and a row carrying
 * one is treated exactly like a row carrying nothing.
 */

/** What emptiness turns into. Unix's epoch, and the two Excel serial-0 days. */
const NOT_A_DATE = new Set(['1970-01-01', '1899-12-30', '1899-12-31', '1900-01-00']);

/** True when the row does not say when it happened. */
export function missingDate(date: string | null | undefined): boolean {
  const d = (date ?? '').trim();
  if (!d) return true;
  if (NOT_A_DATE.has(d.slice(0, 10))) return true;
  // Anything before the business existed, or implausibly far ahead, is a
  // parsing artefact rather than a date somebody meant.
  const year = Number(d.slice(0, 4));
  return !Number.isFinite(year) || year < 2000 || year > 2100;
}

/** The date to show, or '' when the row does not actually have one. */
export function displayDate(date: string | null | undefined): string {
  return missingDate(date) ? '' : (date ?? '').trim();
}
