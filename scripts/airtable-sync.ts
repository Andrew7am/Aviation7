/**
 * Run the Airtable sync from here - the same code the server runs every two
 * minutes.
 *
 *   npx tsx scripts/airtable-sync.ts --dry     (work it out, write nothing)
 *   npx tsx scripts/airtable-sync.ts           (run it)
 *   npx tsx scripts/airtable-sync.ts --full    (read the whole table)
 */
import 'dotenv/config';
import { syncAirtable } from '../src/server/airtableSync';

(async () => {
  const dry = process.argv.includes('--dry');
  const r = await syncAirtable({
    airtableToken: process.env.AIRTABLE_TOKEN!, supabaseUrl: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!, forceFull: process.argv.includes('--full'), dryRun: dry,
  });
  const { preview, ...rest } = r;
  console.log(rest);
  if (preview) {
    const by = new Map<string, number>();
    for (const n of preview.notices) by.set(n.kind, (by.get(n.kind) ?? 0) + 1);
    console.log('notices by kind:', Object.fromEntries(by));
    for (const k of by.keys()) {
      console.log(`\n${k}:`);
      for (const n of preview.notices.filter(n => n.kind === k).slice(0, 6)) console.log('  ' + n.title);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
