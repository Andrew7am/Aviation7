import { supabase, fetchAllRows } from '../utils/supabase';
import { LearnedProfile, LearnedColumns, LearnedRules, headerFingerprint } from '../core/ai/learnedProfile';

type ProfileRow = {
  id: string;
  vendor_name: string;
  fingerprint: string;
  headers: string[];
  columns: LearnedColumns;
  rules: LearnedRules | null;
  is_lcc: boolean;
  usage_count: number;
};

const rowToProfile = (r: ProfileRow): LearnedProfile => ({
  vendorName:  r.vendor_name,
  fingerprint: r.fingerprint,
  isLCC:       r.is_lcc,
  headers:     r.headers,
  columns:     r.columns,
  rules:       r.rules ?? { refund: 'negative_amount' },
});

/**
 * AIProfileService — persistence + analysis for learned vendor formats.
 * Profiles are company-wide (like the raw vendor reference tables): learned
 * once by anyone, reused by everyone, deterministic forever after.
 */
export class AIProfileService {
  async listProfiles(): Promise<LearnedProfile[]> {
    const rows = await fetchAllRows<ProfileRow>((from, to) =>
      supabase.from('ai_vendor_profiles').select('*').range(from, to)
    );
    return rows.map(rowToProfile);
  }

  async saveProfile(profile: LearnedProfile): Promise<void> {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('ai_vendor_profiles').upsert({
      vendor_name: profile.vendorName,
      fingerprint: profile.fingerprint,
      headers:     profile.headers,
      columns:     profile.columns,
      rules:       profile.rules,
      is_lcc:      profile.isLCC,
      created_by:  auth.user?.id ?? null,
    }, { onConflict: 'fingerprint' });
    if (error) throw new Error(error.message);
  }

  async bumpUsage(fingerprint: string): Promise<void> {
    // Best-effort telemetry — never block an import on it.
    const { data } = await supabase.from('ai_vendor_profiles').select('usage_count').eq('fingerprint', fingerprint).single();
    if (!data) return;
    await supabase.from('ai_vendor_profiles')
      .update({ usage_count: (data.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq('fingerprint', fingerprint);
  }

  /** One AI call: send headers + sample rows, get a validated column mapping. */
  async analyzeReport(headers: string[], sampleRows: string[][]): Promise<LearnedProfile> {
    const res = await fetch('/api/ai/analyze-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headers, sampleRows }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `AI analysis failed (${res.status})`);
    return {
      vendorName:  body.vendorName,
      fingerprint: headerFingerprint(headers),
      isLCC:       body.isLCC,
      headers,
      columns:     body.columns,
      rules:       body.rules,
    };
  }
}
