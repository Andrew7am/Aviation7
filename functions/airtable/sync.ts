// Vercel serverless function — keep the team's Airtable "Aviation Tickets"
// here live. Called every two minutes by the database (pg_cron + pg_net,
// carrying AIRTABLE_SYNC_SECRET), and by the app's "Sync now" button
// (carrying the signed-in user's session). The Airtable token and the
// Supabase service key stay on the server.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { syncAirtable } from '../../src/server/airtableSync';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const airtableToken = process.env.AIRTABLE_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.AIRTABLE_SYNC_SECRET;
  if (!airtableToken || !supabaseUrl || !serviceKey || !secret) {
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

  try {
    const result = await syncAirtable({ airtableToken, supabaseUrl, serviceKey, forceFull: req.query.full === '1', fillNow: req.query.fill === '1' });
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
