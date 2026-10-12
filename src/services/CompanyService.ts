import { supabase } from '../utils/supabase';
import type { CompanyAssignment } from '../core/helpers/companies';

/**
 * Requests placed under a company by hand - the ones the team's Airtable
 * does not carry. Read by everyone, written by admins (row-level security).
 */
export class CompanyService {
  async assignments(): Promise<CompanyAssignment[]> {
    const { data, error } = await supabase.from('company_requests').select('req_key, company, set_by, set_at').order('req_key');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async assign(reqKey: string, company: string, by: string): Promise<void> {
    const key = reqKey.trim().toUpperCase();
    if (!key || !company.trim()) throw new Error('A request and a company are both needed.');
    const { error } = await supabase.from('company_requests')
      .upsert({ req_key: key, company: company.trim(), set_by: by, set_at: new Date().toISOString() }, { onConflict: 'req_key' });
    if (error) throw new Error(error.message);
  }

  async unassign(reqKey: string): Promise<void> {
    const { error } = await supabase.from('company_requests').delete().eq('req_key', reqKey);
    if (error) throw new Error(error.message);
  }
}
