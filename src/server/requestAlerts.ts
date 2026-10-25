/**
 * Request alerts: when a request's issued total reaches its figure, email the
 * people named, once. Run after every Airtable sync (every two minutes).
 *
 * Kept cheap on Supabase's egress: an alert's total is worked out again only
 * when a ticket of that request, or a row of theirs under it, has changed
 * since the last check - two one-row reads otherwise. An alert reached whose
 * email has not gone (no mail settings yet, a refused send) tries again on
 * each run without reading anything more.
 *
 * Mail goes out over SMTP, from the server's settings: SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS and, if the sender differs from the login, ALERT_FROM.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { requestIssued } from '../core/helpers/requestTotal';

export interface MailEnv { host?: string; port?: string; user?: string; pass?: string; from?: string }

interface AlertRow {
  id: string; req_num: string; threshold: number; currency: string; recipients: string[];
  last_total: number | null; checked_at: string | null; reached_at: string | null; emailed_at: string | null;
}

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const local = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

async function send(mail: MailEnv, a: AlertRow, total: { total: number; fromBooks: number; fromSheet: number; docs: number }, at: Date) {
  if (!mail.host || !mail.user || !mail.pass) throw new Error('Email is not set up on the server (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  const port = Number(mail.port || 587);
  const t = nodemailer.createTransport({ host: mail.host, port, secure: port === 465, auth: { user: mail.user, pass: mail.pass } });
  const goal = `${fmt(Number(a.threshold))} ${a.currency}`;
  await t.sendMail({
    from: mail.from || mail.user,
    to: a.recipients.join(', '),
    subject: `${a.req_num} has reached ${goal}`,
    text: [
      `${a.req_num} has reached ${goal} issued.`,
      '',
      `Issued so far: ${fmt(total.total)} ${a.currency} (${total.docs} documents)`,
      `  in our books: ${fmt(total.fromBooks)} ${a.currency}`,
      total.fromSheet ? `  on the team's Airtable, not yet in a supplier report: ${fmt(total.fromSheet)} ${a.currency}` : '',
      '',
      `Checked ${local(at)} (UTC+3). Refunds are not taken off; voids and On Hold rows are not counted.`,
      '- Luxury Explorers reconciliation',
    ].filter(l => l !== '').join('\n'),
  });
}

export async function checkRequestAlerts(db: SupabaseClient, mail: MailEnv): Promise<{ checked: number; emailed: string[]; errors: string[] }> {
  const out = { checked: 0, emailed: [] as string[], errors: [] as string[] };
  const { data: alerts, error } = await db.from('request_alerts').select('*').is('emailed_at', null);
  if (error || !alerts?.length) return out;
  for (const a of alerts as AlertRow[]) {
    const now = new Date();
    try {
      let total: ReturnType<typeof requestIssued> | null = null;
      if (!a.reached_at) {
        const like = `%${a.req_num}%`;
        const since = a.checked_at ?? '1970-01-01';
        const [{ data: t1 }, { data: s1 }] = await Promise.all([
          db.from('tickets').select('updated_at').ilike('req_num', like).gt('updated_at', since).limit(1),
          db.from('airtable_tickets').select('synced_at').ilike('req_num', like).gt('synced_at', since).limit(1),
        ]);
        if (a.checked_at && !t1?.length && !s1?.length) continue;
        out.checked++;
        const [{ data: books }, { data: sheet }] = await Promise.all([
          db.from('tickets').select('ticket_no, status, amount, total_doc, currency, req_num').ilike('req_num', like),
          db.from('airtable_tickets').select('serials, status, net_cost, currency, req_num').eq('deleted', false).ilike('req_num', like),
        ]);
        total = requestIssued(a.req_num, a.currency,
          (books ?? []).map(t => ({ ticketNo: t.ticket_no, status: t.status, amount: Number(t.amount), totalDoc: t.total_doc == null ? null : Number(t.total_doc), currency: t.currency, reqNum: t.req_num })),
          (sheet ?? []).map(r => ({ serials: r.serials ?? [], status: r.status, net_cost: r.net_cost == null ? null : Number(r.net_cost), currency: r.currency, req_num: r.req_num })));
        const reached = total.total >= Number(a.threshold);
        await db.from('request_alerts').update({ last_total: total.total, checked_at: now.toISOString(), ...(reached ? { reached_at: now.toISOString() } : {}) }).eq('id', a.id);
        if (!reached) continue;
      }
      const t = total ?? { total: Number(a.last_total ?? 0), fromBooks: Number(a.last_total ?? 0), fromSheet: 0, docs: 0 };
      await send(mail, a, t, now);
      await db.from('request_alerts').update({ emailed_at: now.toISOString(), last_error: null }).eq('id', a.id);
      out.emailed.push(a.req_num);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`${a.req_num}: ${msg}`);
      await db.from('request_alerts').update({ last_error: msg }).eq('id', a.id);
    }
  }
  return out;
}
