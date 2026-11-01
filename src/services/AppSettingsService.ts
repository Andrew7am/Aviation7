import { supabase } from '../utils/supabase';
import { applyAppSettings, type LoadedSettings, type VendorSetting, type PortalSetting, type OfficeSetting } from '../core/config/appSettings';
import type { AirlineLimit } from '../core/helpers/airlineLimit';
export type { LoadedSettings };

/**
 * The Settings screen's own settings (app_settings, 0047) and the request
 * alerts (request_alerts, 0045): read once when the app opens, written by an
 * admin. Loading them puts them where the rules read them - the vendors'
 * currencies, the vendor lists, the Emirates limit - so nothing else has to
 * pass them around.
 */
export interface RequestAlertSetting {
  id: string; reqNum: string; threshold: number; currency: string; recipients: string[];
  lastTotal: number | null; reachedAt: string | null; emailedAt: string | null; lastError: string | null;
}

/** Put one changed setting where the rules read it, with the rest as loaded. */
const apply = (s: LoadedSettings) => applyAppSettings([
  { key: 'vendors', value: s.vendors }, { key: 'airline_limits', value: s.airlineLimits },
  { key: 'portals', value: s.portals }, { key: 'offices', value: s.offices },
]);

export class AppSettingsService {
  async load(): Promise<LoadedSettings> {
    const { data, error } = await supabase.from('app_settings').select('key, value');
    if (error) throw new Error(error.message);
    return applyAppSettings(data ?? []);
  }

  private async save(key: string, value: unknown): Promise<void> {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: auth.user?.email ?? null });
    if (error) throw new Error(error.message);
  }

  /** Every change on the screen in the Activity log, as it now stands. */
  async audit(entity: string, detail: string): Promise<void> {
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from('audit_log').insert({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, user_id: auth.user?.id,
      actor_id: auth.user?.id, actor_email: auth.user?.email ?? 'unknown', entity_type: 'app',
      action: 'EDIT_SETTINGS', entity, detail,
    });
  }

  async saveVendors(vendors: VendorSetting[], all: LoadedSettings): Promise<void> {
    await this.save('vendors', vendors);
    apply({ ...all, vendors });
  }

  async saveAirlineLimits(limits: AirlineLimit[], all: LoadedSettings): Promise<void> {
    await this.save('airline_limits', limits);
    apply({ ...all, airlineLimits: limits });
  }

  async savePortals(portals: PortalSetting[], all: LoadedSettings): Promise<void> {
    await this.save('portals', portals);
    apply({ ...all, portals });
  }

  async saveOffices(offices: OfficeSetting, all: LoadedSettings): Promise<void> {
    await this.save('offices', offices);
    apply({ ...all, offices });
  }

  async requestAlerts(): Promise<RequestAlertSetting[]> {
    const { data, error } = await supabase.from('request_alerts')
      .select('id, req_num, threshold, currency, recipients, last_total, reached_at, emailed_at, last_error').order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(r => ({ id: r.id, reqNum: r.req_num, threshold: Number(r.threshold), currency: r.currency,
      recipients: r.recipients ?? [], lastTotal: r.last_total == null ? null : Number(r.last_total),
      reachedAt: r.reached_at, emailedAt: r.emailed_at, lastError: r.last_error }));
  }

  /** A changed figure or request is a new question: worked out and emailed afresh. */
  async saveRequestAlert(a: Pick<RequestAlertSetting, 'id' | 'reqNum' | 'threshold' | 'currency' | 'recipients'>, isNew: boolean, changedFigure: boolean): Promise<void> {
    const row = { req_num: a.reqNum.trim().toUpperCase(), threshold: a.threshold, currency: a.currency,
      recipients: a.recipients.map(r => r.trim()).filter(Boolean) };
    const fresh = { checked_at: null, reached_at: null, emailed_at: null, last_error: null, last_total: null };
    const { error } = isNew
      ? await supabase.from('request_alerts').insert({ id: a.id, ...row })
      : await supabase.from('request_alerts').update({ ...row, ...(changedFigure ? fresh : {}) }).eq('id', a.id);
    if (error) throw new Error(error.message);
  }

  async deleteRequestAlert(id: string): Promise<void> {
    const { error } = await supabase.from('request_alerts').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
