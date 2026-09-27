import { useState, useEffect, useMemo, useCallback } from 'react';
import { TaxInvoiceService, StoredInvoice } from '../services/TaxInvoiceService';
import { pdfToWords } from '../core/helpers/pdfWords';
import { readIbtekarInvoices } from '../core/parsers/ibtekarInvoiceRead';

export interface FileOutcome {
  file: string;
  saved: string[];
  alreadyHeld: string[];
  /** Already on file, replaced because this copy is the better document. */
  upgraded: string[];
  problems: string[];
  failed?: string;
}

/**
 * The tax invoices on file, and the door they come in through.
 *
 * Reading happens here rather than in the screen because of one rule: a file
 * that yields no invoice is never recorded. Recording an unreadable document
 * as an empty invoice would be worse than refusing it — the tracker would
 * then hold a row saying this invoice covers nothing, and every ticket on it
 * would read as having no tax invoice while the paper sat on the drive.
 */
export function useTaxInvoices(userId: string, vendor = 'Ibtekar') {
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const svc = useMemo(() => new TaxInvoiceService(userId), [userId]);

  const refresh = useCallback(async () => {
    try { setInvoices(await svc.list(vendor)); }
    catch (e) { console.error('tax_invoices error', e); }
    finally { setLoading(false); }
  }, [svc, vendor]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upload = useCallback(async (files: File[]): Promise<FileOutcome[]> => {
    const out: FileOutcome[] = [];
    for (const file of files) {
      try {
        const words = await pdfToWords(await file.arrayBuffer());
        const read = readIbtekarInvoices(words, file.name);
        if (!read.invoices.length) {
          out.push({ file: file.name, saved: [], alreadyHeld: [], upgraded: [], problems: read.problems });
          continue;
        }
        const res = await svc.save(read.invoices, vendor, file.name);
        out.push({
          file: file.name,
          saved: res.saved.map(i => i.invoiceNo),
          alreadyHeld: res.alreadyHeld,
          upgraded: res.upgraded,
          problems: read.problems,
        });
      } catch (e) {
        out.push({
          file: file.name, saved: [], alreadyHeld: [], upgraded: [], problems: [],
          failed: e instanceof Error ? e.message : 'the file could not be read',
        });
      }
    }
    await refresh();
    return out;
  }, [svc, vendor, refresh]);

  const remove = useCallback(async (id: string) => {
    await svc.remove(id);
    await refresh();
  }, [svc, refresh]);

  return { invoices, loading, upload, remove };
}
