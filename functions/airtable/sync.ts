// Vercel serverless function — keep the team's Airtable "Aviation Tickets"
// here live. Called every two minutes by the database (pg_cron + pg_net,
// carrying AIRTABLE_SYNC_SECRET), and by the app's "Sync now" button
// (carrying the signed-in user's session). The Airtable token and the
// Supabase service key stay on the server.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { syncAirtable } from '../../src/server/airtableSync';
import { AIRTABLE_API_ON } from '../../src/core/integrations/airtable';
import { checkRequestAlerts } from '../../src/server/requestAlerts';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const airtableToken = process.env.AIRTABLE_TOKEN || '';
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.AIRTABLE_SYNC_SECRET;
  // With the live connection off, no token is needed: uploads and imports only.
  if ((AIRTABLE_API_ON && !airtableToken) || !supabaseUrl || !serviceKey || !secret) {
    res.status(500).json({ error: 'Airtable sync is not configured on the server' });
    return;
  }

  // The scheduler's secret, or a signed-in user of the app.
  const given = String(req.headers['x-sync-secret'] || '');
  let allowed = given !== '' && given === secret;
  if (!allowed) {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (bearer) {
      const { data } = await createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }).auth.getUser(bearer);
      allowed = !!data?.user;
    }
  }
  if (!allowed) { res.status(401).json({ error: 'Not allowed' }); return; }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  // A request reaching its figure - KSAML2771 at 2,000,000 - emailed once,
  // whether or not their Airtable could be read this time.
  const alerts = () => checkRequestAlerts(db, {
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.ALERT_FROM,
  }).catch(e => ({ checked: 0, emailed: [], errors: [String(e)] }));

  /* ?upload=<id>: their CSV export, written to airtable_csv_rows by the app,
     read instead of the API - for while the API cannot be used. */
  const upload = typeof req.query.upload === 'string' ? req.query.upload : '';
  let csvRows: Record<string, string>[] | undefined;
  if (upload) {
    csvRows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('airtable_csv_rows').select('row').eq('upload_id', upload).order('idx').range(from, from + 999);
      if (error) { res.status(500).json({ error: error.message }); return; }
      csvRows.push(...(data ?? []).map(r => r.row as Record<string, string>));
      if (!data || data.length < 1000) break;
    }
    if (!csvRows.length) { res.status(400).json({ error: 'Nothing was uploaded under that id' }); return; }
  }

  // Cleared before answering: once the answer is sent the function may be stopped.
  const clear = async () => { if (upload) await db.from('airtable_csv_rows').delete().eq('upload_id', upload); };
  try {
    const result = await syncAirtable({ airtableToken, supabaseUrl, serviceKey, forceFull: req.query.full === '1', fillNow: req.query.fill === '1' || !!upload, csvRows });
    const a = await alerts();
    await clear();
    res.status(200).json({ ...result, alerts: a });
  } catch (err) {
    console.error(err);
    await alerts();
    await clear();
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
