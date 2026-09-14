/**
 * The raw Ibtekar statement rows the portal already imported, as JSON.
 *
 * ibtekar_rows keeps the vendor's own statement line for line - document
 * number, file number, running balance - which the ticket row does not.  It is
 * the third source for an invoice number, after the PDFs in the shared folder
 * and the statement of account.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select r.*, i.source_file, i.imported_at
       from ibtekar_rows r
       left join vendor_imports i on i.id = r.vendor_import_id
      order by r.source_row_num`);
  writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
  const withDoc = rows.filter((r: any) => /^INV\d+/i.test(r.doc_no || ''));
  console.log(`ibtekar_rows: ${rows.length}, carrying a document number: ${withDoc.length}`);
  console.log('documents:', [...new Set(withDoc.map((r: any) => r.doc_no))].sort().join(' '));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
