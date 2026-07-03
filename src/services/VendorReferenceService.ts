import { supabase } from '../utils/supabase';

export interface VendorReference {
  slug: string;
  displayName: string;
  seedRows: number;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * VendorReferenceService bridges the raw vendor_*_rows tables (seeded from
 * the canonical Aviation workbook) into the SAME text-in / parser pipeline
 * ImportData.tsx already uses for manual file uploads (useImport.runValidation
 * -> core/parsers/runParser -> detectDuplicates -> TicketService.saveImport).
 * It never touches tickets directly — it only reconstructs a CSV string so
 * the existing, already-reviewed parser/duplicate-detection logic runs
 * unchanged, same as if the user had uploaded that vendor's file by hand.
 */
export class VendorReferenceService {
  async listVendors(): Promise<VendorReference[]> {
    const { data, error } = await supabase
      .from('vendors')
      .select('slug, display_name, seed_rows')
      .order('display_name');
    if (error) throw new Error(error.message);
    return (data ?? []).map(v => ({ slug: v.slug, displayName: v.display_name, seedRows: v.seed_rows }));
  }

  async fetchVendorCsv(slug: string): Promise<string> {
    const { data: columns, error: colErr } = await supabase
      .from('vendor_columns')
      .select('ordinal, sql_name, original')
      .eq('vendor_slug', slug)
      .order('ordinal');
    if (colErr) throw new Error(colErr.message);
    if (!columns || columns.length === 0) throw new Error(`No columns found for vendor "${slug}"`);

    // PostgREST caps a single select() at its configured max-rows (1000 on
    // Supabase by default) and returns that page silently — no error, no
    // indication anything was cut off. Page through with .range() until a
    // page comes back short so every row (e.g. IATA's 1568) is retrieved.
    const PAGE_SIZE = 1000;
    const allRows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: rowErr } = await supabase
        .from(`${slug}_rows`)
        .select('*')
        .order('source_row_num')
        .range(from, from + PAGE_SIZE - 1);
      if (rowErr) throw new Error(rowErr.message);
      allRows.push(...(page ?? []));
      if (!page || page.length < PAGE_SIZE) break;
    }

    const header = columns.map(c => csvEscape(c.original || c.sql_name)).join(',');
    const body = allRows
      .map(row => columns.map(c => csvEscape(String(row[c.sql_name] ?? ''))).join(','))
      .join('\n');

    return `${header}\n${body}`;
  }
}
