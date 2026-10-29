import React, { useState } from 'react';
import { BellRing, X } from 'lucide-react';

/**
 * A request that has reached its figure (KSAML2771 at 2,000,000 AED), across
 * the top until closed - and whether the email about it went, since an email
 * the server could not send would otherwise be silence.
 */
export interface RequestAlert {
  id: string; req_num: string; threshold: number; currency: string; recipients: string[];
  last_total: number | null; reached_at: string | null; emailed_at: string | null; last_error: string | null;
}
const fmt = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

export const RequestAlertBanner: React.FC<{ alerts: RequestAlert[] }> = ({ alerts }) => {
  const [closed, setClosed] = useState<string[]>([]);
  const show = alerts.filter(a => a.reached_at && !closed.includes(a.id));
  if (!show.length) return null;
  return (
    <>
      {show.map(a => (
        <div key={a.id} className="shrink-0 border-b px-4 py-2 flex items-start gap-2 text-xs bg-emerald-100 border-emerald-300 text-emerald-900">
          <BellRing className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold">{a.req_num} has reached {fmt(a.threshold)} {a.currency}</span>
            {a.last_total != null && <> - {fmt(a.last_total)} {a.currency} net, after refunds and commission.</>}{' '}
            {a.emailed_at
              ? <span className="opacity-80">Emailed to {a.recipients.join(', ')}.</span>
              : <span className="font-bold text-red-700">Not emailed: {a.last_error || 'waiting for the next check'}.</span>}
          </div>
          <button onClick={() => setClosed(c => [...c, a.id])} title="Hide" className="opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>
      ))}
    </>
  );
};
