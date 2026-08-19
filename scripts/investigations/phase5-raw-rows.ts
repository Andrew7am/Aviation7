/**
 * PHASE 5 INVESTIGATION (read-only, no database access at all).
 *
 * Dumps the raw PDF runs with their x coordinates for specific documents, plus
 * the column-header row of the same page, so the column each number physically
 * sits under can be read rather than inferred from token order.
 *
 * Run: npx tsx scripts/investigations/phase5-raw-rows.ts <dir> <doc> [doc...]
 */
import { readFileSync, readdirSync } from 'fs';
import { inflateSync } from 'zlib';
import path from 'path';

const DIR = process.argv[2];
const DOCS = process.argv.slice(3);

const ESC: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
const unesc = (t: string) => t
  .replace(/\\([nrtbf()\\])/g, (_, c) => ESC[c])
  .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

export interface Run { x: number; t: string }
export interface Row { page: number; y: number; runs: Run[] }

export function extractRows(file: string): Row[] {
  const buf = readFileSync(file);
  const s = buf.toString('latin1');
  const out: Row[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let page = 0;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let content: string;
    try { content = inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { continue; }
    if (!/\bTj\b|\bTJ\b/.test(content)) continue;
    page++;
    let x = 0, y = 0;
    const runs: (Run & { y: number })[] = [];
    for (const line of content.split(/\r?\n/)) {
      const tm = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+Tm/);
      if (tm) { x = parseFloat(tm[5]); y = parseFloat(tm[6]); }
      else {
        const td = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+Td/);
        if (td) { x += parseFloat(td[1]); y += parseFloat(td[2]); }
      }
      for (const t of line.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) runs.push({ x, y, t: unesc(t[1]) });
      const TJ = line.match(/\[(.*)\]\s*TJ/);
      if (TJ) {
        const j = [...TJ[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(p => unesc(p[1])).join('');
        if (j) runs.push({ x, y, t: j });
      }
    }
    const byY = new Map<number, (Run & { y: number })[]>();
    for (const r of runs) { const k = Math.round(r.y * 2) / 2; const b = byY.get(k); if (b) b.push(r); else byY.set(k, [r]); }
    for (const [y2, arr] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
      out.push({ page, y: y2, runs: arr.sort((a, b) => a.x - b.x).map(r => ({ x: r.x, t: r.t })) });
    }
  }
  return out;
}

export const text = (r: Row) => r.runs.map(x => x.t).join(' ').replace(/\s+/g, ' ').trim();
const show = (r: Row) => r.runs.map(x => `${x.t}@${x.x.toFixed(0)}`).join('  ');

if (DOCS.length) {
  for (const f of readdirSync(DIR).filter(x => /FCAGBILLDET.*\.pdf$/i.test(x)).sort()) {
    const rows = extractRows(path.join(DIR, f));
    const hits = rows.map((r, i) => ({ r, i })).filter(({ r }) => DOCS.some(d => text(r).includes(d)));
    if (!hits.length) continue;
    console.log(`\n${'#'.repeat(100)}\n# ${f}\n${'#'.repeat(100)}`);
    const pages = new Set(hits.map(h => h.r.page));
    // The column headings for each page the hits live on.
    for (const p of pages) {
      const hdr = rows.filter(r => r.page === p && /BALANCE|COMM|TRNC|AMOUNT/i.test(text(r)) && !/^\d{3}\s/.test(text(r)));
      console.log(`\n--- page ${p} column headings ---`);
      for (const h of hdr.slice(0, 8)) console.log(`   ${show(h)}`);
    }
    for (const { r, i } of hits) {
      console.log(`\n--- page ${r.page} y=${r.y} ---`);
      for (let k = Math.max(0, i - 1); k <= Math.min(rows.length - 1, i + 2); k++) {
        console.log(`   ${k === i ? '>>' : '  '} ${show(rows[k])}`);
      }
    }
  }
}
