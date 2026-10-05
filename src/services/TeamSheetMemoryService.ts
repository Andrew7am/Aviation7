import { supabase } from '../utils/supabase';
import type { Explanation, SnapRow } from '../core/helpers/sheetMemory';

/**
 * What the Team Sheet Check remembers between runs - explained differences
 * and the last sheet uploaded. See sheetMemory.ts for why.
 */
export class TeamSheetMemoryService {
  constructor(private userId: string) {}

  async explanations(): Promise<Explanation[]> {
    const { data, error } = await supabase.from('sheet_explanations').select('*');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id, findingKey: r.finding_key, fingerprint: r.fingerprint, note: r.note,
      createdBy: r.created_by ?? undefined, createdAt: r.created_at,
    }));
  }

  /** Explain a difference, or re-explain it at its new figures. */
  async explain(findingKey: string, fingerprint: string, note: string, by: string): Promise<void> {
    const { error } = await supabase.from('sheet_explanations').upsert({
      id: crypto.randomUUID(), user_id: this.userId, finding_key: findingKey, fingerprint, note,
      created_by: by, created_at: new Date().toISOString(),
    }, { onConflict: 'finding_key' });
    if (error) throw new Error(error.message);
  }

  async unexplain(findingKey: string): Promise<void> {
    const { error } = await supabase.from('sheet_explanations').delete().eq('finding_key', findingKey);
    if (error) throw new Error(error.message);
  }

  /** The latest sheet saved with at least `minRows` rows - so a short
   *  export of a handful of rows is never the sheet everything is laid against. */
  async lastSnapshot(minRows = 0): Promise<{ fileName: string; uploadedAt: string; rows: SnapRow[] } | null> {
    const { data, error } = await supabase.from('team_sheet_snapshots')
      .select('file_name, uploaded_at, rows').order('uploaded_at', { ascending: false }).limit(6);
    if (error) throw new Error(error.message);
    const r = (data ?? []).find(x => ((x.rows as SnapRow[]) ?? []).length >= minRows);
    return r ? { fileName: r.file_name ?? '', uploadedAt: r.uploaded_at, rows: r.rows as SnapRow[] } : null;
  }

  async saveSnapshot(fileName: string, rows: SnapRow[]): Promise<void> {
    const { error } = await supabase.from('team_sheet_snapshots').insert({
      id: crypto.randomUUID(), user_id: this.userId, file_name: fileName, rows,
    });
    if (error) throw new Error(error.message);
  }
}
