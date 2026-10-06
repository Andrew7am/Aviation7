/**
 * Schedule (or re-schedule) the Airtable sync: every two minutes the database
 * calls the Vercel function with the sync secret from the environment.
 *
 *   npx tsx scripts/schedule-airtable-sync.ts            (create or replace the job)
 *   npx tsx scripts/schedule-airtable-sync.ts --off      (remove it)
 *   npx tsx scripts/schedule-airtable-sync.ts --status   (the job and its last runs)
 */
import 'dotenv/config';
import { Client } from 'pg';

const JOB = 'airtable-sync';
const URL = process.env.AIRTABLE_SYNC_URL || 'https://aviation7.vercel.app/api/airtable/sync';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const exists = (await c.query(`select jobid from cron.job where jobname = $1`, [JOB])).rows[0];
  if (process.argv.includes('--status')) {
    console.log((await c.query(`select jobid, jobname, schedule, active from cron.job where jobname = $1`, [JOB])).rows);
    console.log((await c.query(`select status, return_message, start_time from cron.job_run_details where jobid = $1 order by start_time desc limit 5`, [exists?.jobid ?? -1])).rows);
    console.log((await c.query(`select status_code, left(content::text, 160) content, created from net._http_response order by created desc limit 3`)).rows);
    await c.end(); return;
  }
  if (exists) await c.query(`select cron.unschedule($1)`, [JOB]);
  if (process.argv.includes('--off')) { console.log('removed'); await c.end(); return; }
  const secret = process.env.AIRTABLE_SYNC_SECRET;
  if (!secret) throw new Error('AIRTABLE_SYNC_SECRET is not set');
  const cmd = `select net.http_post(url := ${lit(URL)}, headers := jsonb_build_object('x-sync-secret', ${lit(secret)}, 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 60000)`;
  await c.query(`select cron.schedule($1, '*/2 * * * *', $2)`, [JOB, cmd]);
  console.log(`scheduled ${JOB}: every 2 minutes -> ${URL}`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });

function lit(s: string) { return `'${s.replace(/'/g, "''")}'`; }
