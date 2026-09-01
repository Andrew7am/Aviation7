/**
 * Which source files are actually reachable?
 *
 * Walks the import graph out from every real entry point and reports what it
 * never arrives at. Read-only — it deletes nothing and only reports, because
 * "no import found" is evidence, not proof: a file can still be loaded
 * dynamically, referenced by config, or be an entry point nobody listed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname, relative } from 'path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', '.firebase'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const allFiles = walk(ROOT).map(f => relative(ROOT, f).replace(/\\/g, '/'));

/** Entry points: what actually gets run or served. */
const ENTRIES = [
  'src/main.tsx',        // index.html -> the browser app
  'server.ts',           // the dev/prod express server
  ...allFiles.filter(f => f.startsWith('api/')),        // Vercel functions
  ...allFiles.filter(f => f.startsWith('scripts/') && !f.includes('/investigations/')),
];

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g;

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;               // package, not local
  const base = resolve(dirname(join(ROOT, fromFile)), spec);
  for (const cand of [base, base + '.ts', base + '.tsx',
                      join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) {
      return relative(ROOT, cand).replace(/\\/g, '/');
    }
  }
  return null;
}

const reached = new Set<string>();
const queue = [...ENTRIES];
while (queue.length) {
  const f = queue.pop()!;
  if (reached.has(f) || !existsSync(join(ROOT, f))) continue;
  reached.add(f);
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const target = resolveImport(f, spec);
    if (target && !reached.has(target)) queue.push(target);
  }
}

const unreached = allFiles.filter(f => !reached.has(f)).sort();

console.log(`source files: ${allFiles.length}`);
console.log(`reachable from an entry point: ${reached.size}`);
console.log(`never reached: ${unreached.length}\n`);

const groups: Record<string, string[]> = {};
for (const f of unreached) {
  const g = f.startsWith('scripts/investigations/') ? 'scripts/investigations (throwaway probes)'
          : f.startsWith('scripts/')                ? 'scripts'
          : f.startsWith('src/')                    ? 'src'
          : 'root';
  (groups[g] ??= []).push(f);
}
for (const [g, files] of Object.entries(groups)) {
  console.log(`— ${g}`);
  files.forEach(f => console.log(`    ${f}`));
  console.log();
}

// Who, if anyone, mentions each unreached file by name anywhere in the repo?
console.log('--- any textual mention elsewhere? ---');
const haystack = allFiles.filter(f => reached.has(f))
  .map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
const configs = ['package.json', 'vite.config.ts', 'tsconfig.json', 'vercel.json', 'firebase.json']
  .filter(f => existsSync(join(ROOT, f)))
  .map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
for (const f of unreached) {
  const stem = f.split('/').pop()!.replace(/\.tsx?$/, '');
  const inCode = haystack.includes(stem);
  const inConfig = configs.includes(stem);
  if (inCode || inConfig) {
    console.log(`  ${f} — mentioned in ${[inCode && 'code', inConfig && 'config'].filter(Boolean).join(' + ')}`);
  }
}
console.log('  (anything not listed above is mentioned nowhere)');
