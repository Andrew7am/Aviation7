import Papa from 'papaparse';

/**
 * Pasted text into a grid of cells.
 *
 * PapaParse works out the delimiter on its own for the forms a file uses —
 * commas, tabs, semicolons. It has no notion of columns lined up with spaces,
 * which is what arrives when a table is copied out of a PDF, an email, or a
 * terminal, and what several people reach for when they copy a couple of rows
 * out of a spreadsheet by hand.
 *
 * Left alone, such a paste comes back as one field per line. Nothing then
 * fails: the parsers look for their columns, find none, and build a row out of
 * whatever the single cell contained — one Turkish paste produced a ticket
 * numbered with the whole line, priced at 2.37e+22, in a currency the row
 * never mentioned. It looked like an ordinary row on screen, ready to import.
 *
 * So: if the delimited read gives a single column and the text is plainly
 * laid out in columns, split it on runs of whitespace instead. If that still
 * leaves one column, say so rather than handing back something a parser will
 * quietly turn into a ticket.
 */
export interface ParsedGrid {
  rows: string[][];
  /** How the columns were found. 'none' means they were not. */
  delimiter: 'papa' | 'whitespace' | 'none';
}

/** A line that looks like several columns run together. Two or more spaces
 *  between values is the usual shape; a single space is not enough on its own
 *  because passenger names and routes contain them. */
const COLUMNAR = /\S(?:[ \t]{2,}|\t)\S/;

export function parseGrid(text: string): ParsedGrid {
  const clean = text.trim();
  if (!clean) return { rows: [], delimiter: 'none' };

  const rows = Papa.parse(clean, { skipEmptyLines: true }).data as string[][];
  const widest = rows.reduce((w, r) => Math.max(w, r.length), 0);
  if (widest > 1) return { rows, delimiter: 'papa' };

  // One column. Either the paste really is a single column, or the delimiter
  // is whitespace and nothing has been split at all.
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (!lines.some(l => COLUMNAR.test(l))) return { rows, delimiter: 'none' };

  const split = lines.map(l => l.trim().split(/[ \t]{2,}|\t/).map(c => c.trim()));
  const splitWidest = split.reduce((w, r) => Math.max(w, r.length), 0);
  if (splitWidest > 1) return { rows: split, delimiter: 'whitespace' };

  return { rows, delimiter: 'none' };
}

/**
 * The complaint to show when a paste could not be split into columns.
 *
 * Returned rather than thrown so the caller can put it where its own errors
 * go; empty when the grid is usable.
 */
export function gridProblem(g: ParsedGrid): string {
  if (g.delimiter !== 'none') return '';
  if (g.rows.length === 0) return 'Please enter some data.';
  return 'The columns could not be told apart — every line came through as one value. '
       + 'Paste it as tab- or comma-separated text, or upload the file itself.';
}
