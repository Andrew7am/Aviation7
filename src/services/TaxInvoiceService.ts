import { v4 as uuidv4 } from 'uuid';
import { supabase, fetchAllRows } from '../utils/supabase';
import type { HeldInvoice } from '../core/helpers/taxInvoiceCoverage';
import { preferReading, type ReadInvoice } from '../core/parsers/ibtekarInvoiceRead';

/**
 * The tax invoices we hold, kept rather than looked at once.
 *
 * The Document Check screen has always been able to read an invoice and hold
 * it against the ledger; what it could not do is remember. Every upload was a
 * conversation that ended when the page did, so "which of these tickets did
 * we ever get a tax invoice for" had no answer at all.
 *
 * Saving is deliberately dull: what the document says, and the serials it
 * prints. No verdict is stored. Whether a ticket is covered is worked out
 * every time from the invoices and the ledger as they stand, because the
 * ledger keeps moving and a stored verdict would go stale the first time a
 * ticket was imported after its invoice.
 */

interface InvoiceRow {
  id: string;
  vendor: string;
  invoice_no: string;
  their_serial: string | null;
  invoice_date: string | null;
  is_tax_invoice: boolean;
  currency: string;
  net: number | null;
  vat: number | null;
  total: number | null;
  layout: string | null;
  source_file: string | null;
  note: string | null;
  created_at: string;
}

interface LineRow {
  id: string;
  invoice_id: string;
  airline_code: string | null;
  ticket_serial: string;
  passenger: string | null;
  sector: string | null;
  pnr: string | null;
  amount: number | null;
  travel_date: string | null;
  issue_date: string | null;
}

export interface StoredInvoice extends HeldInvoice {
  id: string;
  vendor: string;
  currency: string;
  createdAt: string;
  note?: string;
  lines: {
    airlineCode: string;
    ticketSerial: string;
    passenger: string;
    sector: string;
    pnr: string;
    amount: number | null;
    travelDate: string;
    issueDate: string;
  }[];
}

export interface SaveOutcome {
  saved: StoredInvoice[];
  /** Invoice numbers already on file, left exactly as they were. */
  alreadyHeld: string[];
  /** Already on file, and replaced because this reading is a better document. */
  upgraded: string[];
}

/** How good a reading is, for choosing between two of the same invoice. */
const rank = (
  isTax: boolean, total: number | null, lines: number, net: number | null, vat: number | null,
) => [isTax ? 1 : 0, total !== null ? 1 : 0, lines, net !== null && vat !== null ? 1 : 0];

const beats = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

const nullDate = (d: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export class TaxInvoiceService {
  constructor(private userId: string) {}

  async list(vendor?: string): Promise<StoredInvoice[]> {
    const invoices = await fetchAllRows<InvoiceRow>((from, to) => {
      const q = supabase.from('tax_invoices').select('*')
        .order('invoice_date', { ascending: false }).range(from, to);
      return vendor ? q.eq('vendor', vendor) : q;
    });
    if (!invoices.length) return [];

    const lines = await fetchAllRows<LineRow>((from, to) =>
      supabase.from('tax_invoice_lines').select('*').range(from, to));

    const byInvoice = new Map<string, LineRow[]>();
    for (const l of lines) {
      if (!byInvoice.has(l.invoice_id)) byInvoice.set(l.invoice_id, []);
      byInvoice.get(l.invoice_id)!.push(l);
    }

    return invoices.map(r => {
      const ls = byInvoice.get(r.id) ?? [];
      return {
        id: r.id,
        vendor: r.vendor,
        invoiceNo: r.invoice_no,
        theirSerial: r.their_serial ?? undefined,
        invoiceDate: r.invoice_date ?? '',
        isTaxInvoice: r.is_tax_invoice,
        currency: r.currency,
        net: r.net == null ? null : Number(r.net),
        vat: r.vat == null ? null : Number(r.vat),
        total: r.total == null ? null : Number(r.total),
        layout: r.layout ?? undefined,
        sourceFile: r.source_file ?? undefined,
        note: r.note ?? undefined,
        createdAt: r.created_at,
        serials: ls.map(l => l.ticket_serial),
        lines: ls.map(l => ({
          airlineCode: l.airline_code ?? '',
          ticketSerial: l.ticket_serial,
          passenger: l.passenger ?? '',
          sector: l.sector ?? '',
          pnr: l.pnr ?? '',
          amount: l.amount == null ? null : Number(l.amount),
          travelDate: l.travel_date ?? '',
          issueDate: l.issue_date ?? '',
        })),
      };
    });
  }

  /**
   * Record what was read.
   *
   * An invoice already on file is left alone and named in `alreadyHeld`
   * rather than overwritten. The same bundle gets dropped on the screen more
   * than once, and a silent overwrite would replace a corrected record with
   * a fresh reading of the same PDF without anyone knowing it happened —
   * `replace` is how you ask for that on purpose.
   */
  async save(
    read: ReadInvoice[], vendor: string, sourceFile: string,
    currency = 'SAR', replace = false,
  ): Promise<SaveOutcome> {
    // The same number can appear twice inside one bundle, and the same
    // invoice can arrive on both templates. Keep the better reading of each.
    const best = new Map<string, ReadInvoice>();
    for (const r of read.filter(r => r.invoice.invoice)) {
      const seen = best.get(r.invoice.invoice);
      best.set(r.invoice.invoice, seen ? preferReading(seen, r) : r);
    }
    const wanted = [...best.values()];
    if (!wanted.length) return { saved: [], alreadyHeld: [], upgraded: [] };

    const { data: existing } = await supabase
      .from('tax_invoices')
      .select('id, invoice_no, is_tax_invoice, total, net, vat')
      .eq('vendor', vendor).in('invoice_no', wanted.map(r => r.invoice.invoice));
    const held = new Map((existing ?? []).map(e => [e.invoice_no, e]));

    // How many tickets each one on file already names. Without this the
    // comparison below would rate every stored invoice as naming none, and
    // so re-import the whole folder on every upload.
    const heldLines = new Map<string, number>();
    if (held.size) {
      const { data: ls } = await supabase.from('tax_invoice_lines')
        .select('invoice_id').in('invoice_id', [...held.values()].map(e => e.id));
      for (const l of ls ?? [])
        heldLines.set(l.invoice_id, (heldLines.get(l.invoice_id) ?? 0) + 1);
    }

    const alreadyHeld: string[] = [];
    const upgraded: string[] = [];
    const toWrite: ReadInvoice[] = [];
    for (const r of wanted) {
      const have = held.get(r.invoice.invoice);
      if (!have) { toWrite.push(r); continue; }

      /* What is on file is not automatically what to keep. A bundle read
         first can hold the same invoice with no totals and no TAX INVOICE
         heading, and the proper copy of it turn up in the next folder. A
         document that calls itself a tax invoice supersedes one that does
         not — that is the whole distinction being tracked. */
      const mine = rank(r.invoice.taxInvoice, r.invoice.total, r.invoice.lines.length,
                        r.invoice.subTotal, r.invoice.vat);
      const theirs = rank(have.is_tax_invoice, have.total == null ? null : Number(have.total),
                          heldLines.get(have.id) ?? 0,
                          have.net == null ? null : Number(have.net),
                          have.vat == null ? null : Number(have.vat));
      if (!replace && !beats(mine, theirs)) { alreadyHeld.push(r.invoice.invoice); continue; }
      // The lines go with it: `on delete cascade`.
      await supabase.from('tax_invoices').delete().eq('id', have.id);
      if (!replace) upgraded.push(r.invoice.invoice);
      toWrite.push(r);
    }
    if (!toWrite.length) return { saved: [], alreadyHeld, upgraded };

    const invoiceRows = toWrite.map(r => ({
      id: uuidv4(),
      user_id: this.userId,
      vendor,
      invoice_no: r.invoice.invoice,
      their_serial: r.theirSerial || null,
      invoice_date: nullDate(r.invoice.invoiceDate),
      is_tax_invoice: r.invoice.taxInvoice,
      currency,
      net: r.invoice.subTotal,
      vat: r.invoice.vat,
      total: r.invoice.total,
      layout: r.layout,
      source_file: sourceFile || null,
    }));

    const { error: invErr } = await supabase.from('tax_invoices').insert(invoiceRows);
    if (invErr) throw invErr;

    const lineRows = toWrite.flatMap((r, i) =>
      // One row per document the invoice prints. A serial printed twice on the
      // same invoice is the same fact stated twice, and the unique constraint
      // would reject the pair, so it is de-duplicated on the way in.
      [...new Map(r.invoice.lines.map(l => [l.ticketNo, l])).values()].map(l => ({
        id: uuidv4(),
        invoice_id: invoiceRows[i].id,
        airline_code: l.airline || null,
        ticket_serial: l.ticketNo,
        passenger: l.passenger || null,
        sector: l.sector || null,
        pnr: l.pnr || null,
        amount: l.amount,
        travel_date: nullDate(l.travelDate),
        issue_date: nullDate(l.issueDate),
      })));

    if (lineRows.length) {
      const { error: lineErr } = await supabase.from('tax_invoice_lines').insert(lineRows);
      // An invoice with no lines is a record of an absence, not a record of
      // an invoice, so the header goes back out with them.
      if (lineErr) {
        await supabase.from('tax_invoices').delete()
          .in('id', invoiceRows.map(r => r.id));
        throw lineErr;
      }
    }

    return { saved: await this.byIds(invoiceRows.map(r => r.id)), alreadyHeld, upgraded };
  }

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('tax_invoices').delete().eq('id', id);
    if (error) throw error;
  }

  private async byIds(ids: string[]): Promise<StoredInvoice[]> {
    const all = await this.list();
    const want = new Set(ids);
    return all.filter(i => want.has(i.id));
  }
}
