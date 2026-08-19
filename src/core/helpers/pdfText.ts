/**
 * pdfText — pull the text layer out of a PDF, in the browser, with no
 * dependency and no OCR.
 *
 * BSP invoices are generated documents: every character is real text inside
 * FlateDecode-compressed content streams. So the job is to inflate those
 * streams and read the text-showing operators, not to look at pixels.
 *
 * Inflation uses the platform's own DecompressionStream, which every current
 * browser ships, rather than pulling in a zlib library for one file format.
 *
 * Output is one string per visual row, reconstructed from the PDF's text
 * positioning operators. A PDF has no concept of a "line" — it places runs of
 * glyphs at (x, y) coordinates — so rows are rebuilt by grouping runs that
 * share a y and ordering them by x. Without that, a table comes out as
 * scrambled fragments.
 */

const LATIN1 = new TextDecoder('latin1');

/** Inflate a zlib/deflate block. Returns null when the stream isn't deflate
 *  (PDFs also carry images and font programs we simply skip). */
async function inflate(bytes: Uint8Array): Promise<string | null> {
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const ds = new DecompressionStream(format);
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      return LATIN1.decode(buf);
    } catch {
      /* try the next format */
    }
  }
  return null;
}

const ESCAPES: Record<string, string> = {
  n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\',
};

/** Resolve PDF string escapes: \n \( \\ and octal \053. */
function unescapePdfString(raw: string): string {
  return raw
    .replace(/\\([nrtbf()\\])/g, (_, ch) => ESCAPES[ch])
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

interface Run { x: number; y: number; text: string }

/** Read one content stream into positioned text runs. */
function runsFromStream(content: string): Run[] {
  const runs: Run[] = [];
  let x = 0;
  let y = 0;
  for (const line of content.split(/\r?\n/)) {
    // Tm sets the text matrix absolutely; Td moves relative to it.
    const tm = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+Tm/);
    if (tm) { x = parseFloat(tm[5]); y = parseFloat(tm[6]); }
    else {
      const td = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+Td/);
      if (td) { x += parseFloat(td[1]); y += parseFloat(td[2]); }
    }

    // (text) Tj
    for (const m of line.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      runs.push({ x, y, text: unescapePdfString(m[1]) });
    }
    // [(a) -250 (b)] TJ — kerned runs; the numbers are spacing, not content.
    const tj = line.match(/\[(.*)\]\s*TJ/);
    if (tj) {
      const joined = [...tj[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)]
        .map(p => unescapePdfString(p[1])).join('');
      if (joined) runs.push({ x, y, text: joined });
    }
  }
  return runs;
}

/** One piece of text and the x it was printed at. */
export interface PdfRun { x: number; text: string }

/**
 * A visual row: its reading-order text, plus the runs it was built from.
 *
 * The runs matter because a table's meaning lives in its columns, not in the
 * order its tokens happen to appear. A BSP invoice prints Standard Commission
 * and Supplementary Commission in their own columns, and the only reliable way
 * to tell which number is which is the x it sits at.
 */
export interface PdfRow { text: string; runs: PdfRun[] }

/** Group runs into visual rows: same y (to half a unit) is one row, ordered
 *  left to right, top of page first. */
function rowsFromRuns(runs: Run[]): PdfRow[] {
  const byRow = new Map<number, Run[]>();
  for (const run of runs) {
    const key = Math.round(run.y * 2) / 2;
    const bucket = byRow.get(key);
    if (bucket) bucket.push(run); else byRow.set(key, [run]);
  }
  return [...byRow.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, group]) => {
      const ordered = group.sort((a, b) => a.x - b.x);
      return {
        text: ordered.map(r => r.text).join(' ').replace(/\s+/g, ' ').trim(),
        runs: ordered.map(r => ({ x: r.x, text: r.text })),
      };
    })
    .filter(r => r.text);
}

// ASCII record/unit separators (0x1E / 0x1F) — chosen because that is
// precisely what they are for, and no PDF text layer contains them. Built
// from char codes rather than written literally so they survive any
// reformatting of this file.
const RUN_SEP = String.fromCharCode(0x1e);
const FIELD_SEP = String.fromCharCode(0x1f);

/** Pack runs into a single CSV-safe field so positions survive the grid. */
export function encodeRuns(runs: PdfRun[]): string {
  return runs.map(r => `${Math.round(r.x)}${FIELD_SEP}${r.text}`).join(RUN_SEP);
}

/**
 * Render extracted rows as the CSV the parsers consume: the row's text in one
 * quoted field, its positions in a second.
 *
 * One quoted field for the text because a PDF row has no delimiters and the
 * commas inside "4,080.00" would otherwise be read as column breaks.
 */
export function pdfRowsToCsv(rows: PdfRow[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return rows.map(r => `${q(r.text)},${q(encodeRuns(r.runs))}`).join('\n');
}

/** Unpack what encodeRuns produced. Returns [] for anything else, so a grid
 *  that never carried positions simply reports having none. */
export function decodeRuns(packed: string | undefined): PdfRun[] {
  if (!packed) return [];
  const out: PdfRun[] = [];
  for (const part of packed.split(RUN_SEP)) {
    const at = part.indexOf(FIELD_SEP);
    if (at < 0) continue;
    const x = Number(part.slice(0, at));
    if (Number.isFinite(x)) out.push({ x, text: part.slice(at + 1) });
  }
  return out;
}

/**
 * Extract every text row from a PDF, in document order.
 * Throws when the file carries no text layer at all — that means a scanned
 * image, which needs OCR and is out of scope; failing loudly is better than
 * silently importing nothing.
 */
export async function extractPdfRows(data: ArrayBuffer): Promise<PdfRow[]> {
  const bytes = new Uint8Array(data);
  const raw = LATIN1.decode(bytes);

  const rows: PdfRow[] = [];
  let sawStream = false;

  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    sawStream = true;

    const content = await inflate(bytes.subarray(start, end));
    if (!content || !/\bTj\b|\bTJ\b/.test(content)) continue;
    rows.push(...rowsFromRuns(runsFromStream(content)));
  }

  if (rows.length === 0) {
    throw new Error(
      sawStream
        ? 'This PDF has no readable text layer — it looks like a scan. Ask the issuer for the original PDF.'
        : 'Could not read this PDF: no content streams found.'
    );
  }
  return rows;
}
