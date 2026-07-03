import 'dotenv/config';
import { Client } from 'pg';
import Papa from 'papaparse';
import { runParser } from '../src/core/parsers';

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const vendors = (await client.query('select slug, display_name, seed_rows from vendors order by display_name')).rows;

  let grandDbRows = 0, grandParsed = 0, grandErrors = 0;

  for (const v of vendors) {
    const cols = (await client.query(
      'select ordinal, sql_name, original from vendor_columns where vendor_slug = $1 order by ordinal',
      [v.slug]
    )).rows;
    const rows = (await client.query(`select * from ${v.slug}_rows order by source_row_num`)).rows;

    const header = cols.map((c: any) => csvEscape(c.original || c.sql_name)).join(',');
    const body = rows.map((row: any) => cols.map((c: any) => csvEscape(String(row[c.sql_name] ?? ''))).join(',')).join('\n');
    const csv = `${header}\n${body}`;

    const allRows = Papa.parse(csv.trim(), { skipEmptyLines: true }).data as string[][];
    const { rows: parsed, errors, warnings, parserName, confidence } = runParser(allRows, v.display_name, 'SAR', v.display_name);

    grandDbRows += rows.length;
    grandParsed += parsed.length;
    grandErrors += errors.length;

    const diff = rows.length - parsed.length;
    const flag = diff > 0 ? `  <<<< ${diff} MISSING` : '';
    console.log(
      `${v.slug.padEnd(14)} db=${String(rows.length).padStart(5)}  parsed=${String(parsed.length).padStart(5)}  errors=${String(errors.length).padStart(3)}  warnings=${String(warnings.length).padStart(4)}  parser=${parserName.padEnd(12)} conf=${confidence}%${flag}`
    );
    if (errors.length > 0) {
      errors.slice(0, 3).forEach((e: string) => console.log(`    ! ${e}`));
      if (errors.length > 3) console.log(`    ... +${errors.length - 3} more`);
    }
  }

  console.log('---');
  console.log(`TOTAL  db=${grandDbRows}  parsed=${grandParsed}  errors=${grandErrors}  gap=${grandDbRows - grandParsed}`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
