/**
 * What one request's file is called inside the zip.
 *
 * This is not the tab-name problem. A worksheet tab is capped at 31
 * characters and forbids a particular five; a file name has no useful length
 * limit here but must survive Windows, which rejects a different set, treats
 * names case-insensitively, and reserves a handful of device names outright.
 * A zip holding both KSAML1685.xlsx and ksaml1685.xlsx extracts to one file
 * on Windows and the second silently replaces the first — so a request's
 * tickets would vanish on the way to the person who needed them.
 *
 * `taken` carries what has already been used, compared case-insensitively
 * for that reason.
 */

/** Windows forbids these in a file name, and control characters. */
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Device names Windows reserves whatever the extension. */
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

export function requestFileName(reqNum: string, taken: Set<string>): string {
  let base = (reqNum || '').replace(FORBIDDEN, '-').trim()
    // Windows drops a trailing dot or space silently, which would turn
    // "REQ12141." into "REQ12141" and collide with the real one.
    .replace(/[. ]+$/, '');
  if (!base) base = 'UNFILED';
  if (RESERVED.has(base.toUpperCase())) base = `${base}-request`;

  /* `taken` holds the finished FILE NAME, extension and all, not the bare
     request. The two are not interchangeable: a set of bare names cannot be
     seeded with the summary's "_Summary.xlsx", and a request called
     _Summary would then be written straight over it. */
  let file = `${base}.xlsx`;
  for (let n = 2; taken.has(file.toUpperCase()); n++) file = `${base} (${n}).xlsx`;
  taken.add(file.toUpperCase());
  return file;
}
