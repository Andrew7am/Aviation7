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

/**
 * Put a row back together that the copy broke into pieces.
 *
 * A table copied out of a web page wraps: a long cell pushes the rest of
 * the row onto the next line, and the clipboard keeps the break without
 * quoting it. Ibtekar's report does this on every single ticket, in three
 * pieces —
 *
 *     2026-09-21  7FYTSN  RUHS22420  RUHS2234T  JAMJOOM HYTHAM TALAL
 *     065-4862141169
 *     issd  Electron  BSP  SV  JED-RUH; RUH-JED  CASH  0  0.00 SAR  ...
 *
 * — and read as three rows it produces one ticket numbered 0, with the
 * PNR reading "ELECTRON" and the route in the passenger's column. Which
 * is exactly what the import preview showed.
 *
 * The repair leans on one fact: every real row has the same number of
 * columns as the header. So a run of short rows whose widths add up to
 * EXACTLY that number is one row, and anything else is left alone. That
 * exactness is the whole safety of it - a genuinely short row, a totals
 * line, a blank separator, will not add up, and nothing is joined on a
 * guess.
 */
export function unwrapRows(rows: string[][]): string[][] {
  if (rows.length < 2) return rows;

  // The widest row is the whole one. Not the most common: when every
  // ticket wraps into three pieces the pieces outnumber the whole rows
  // two to one, and the commonest width is a fragment's.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  if (width < 2) return rows;
  // Nothing short: nothing wrapped.
  if (!rows.some(r => r.length < width)) return rows;

  const out: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length >= width) { out.push(rows[i]); continue; }

    // Gather forward while the pieces could still add up.
    let joined = rows[i].slice();
    let j = i;
    while (joined.length < width && j + 1 < rows.length && rows[j + 1].length < width) {
      joined = joined.concat(rows[j + 1]);
      j++;
    }
    if (joined.length === width) { out.push(joined); i = j; }
    else out.push(rows[i]);   // did not add up - leave it exactly as it was
  }
  return out;
}

export function parseGrid(text: string): ParsedGrid {
  const clean = text.trim();
  if (!clean) return { rows: [], delimiter: 'none' };

  const rows = unwrapRows(Papa.parse(clean, { skipEmptyLines: true }).data as string[][]);
  const widest = rows.reduce((w, r) => Math.max(w, r.length), 0);
  if (widest > 1) return { rows, delimiter: 'papa' };

  // One column. Either the paste really is a single column, or the delimiter
  // is whitespace and nothing has been split at all.
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (!lines.some(l => COLUMNAR.test(l))) return { rows, delimiter: 'none' };

  const split = unwrapRows(
    lines.map(l => l.trim().split(/[ \t]{2,}|\t/).map(c => c.trim())));
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
