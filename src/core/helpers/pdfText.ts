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

/** Group runs into visual rows: same y (to half a unit) is one row, ordered
 *  left to right, top of page first. */
function rowsFromRuns(runs: Run[]): string[] {
  const byRow = new Map<number, Run[]>();
  for (const run of runs) {
    const key = Math.round(run.y * 2) / 2;
    const bucket = byRow.get(key);
    if (bucket) bucket.push(run); else byRow.set(key, [run]);
  }
  return [...byRow.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, group]) =>
      group.sort((a, b) => a.x - b.x).map(r => r.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Extract every text row from a PDF, in document order.
 * Throws when the file carries no text layer at all — that means a scanned
 * image, which needs OCR and is out of scope; failing loudly is better than
 * silently importing nothing.
 */
export async function extractPdfRows(data: ArrayBuffer): Promise<string[]> {
  const bytes = new Uint8Array(data);
  const raw = LATIN1.decode(bytes);

  const rows: string[] = [];
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
