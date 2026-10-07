/**
 * The QR code on a Saudi e-invoice, read.
 *
 * A final tax invoice in Saudi Arabia is one the ZATCA system issued, and the
 * mark of that is the QR code: base64 of a run of tag-length-value fields —
 * seller, seller VAT number, time, total with VAT, the VAT — and, from Phase 2
 * on, the invoice hash, its signature and the signing key.
 *
 * It is the thing to check, not the heading. Ibtekar's booking system prints
 * "TAX INVOICE | فاتورة ضريبية" across the top of its own printouts too
 * (INV264215, INV264288), and those were filed as tax invoices on the strength
 * of that heading. They carry no QR code; the same tickets came back later on
 * invoices 1599 and 1600, which do.
 */

export interface ZatcaQr {
  seller: string;
  vatNo: string;
  /** As printed in the code: 2026-10-07T00:00:00. */
  timestamp: string;
  total: number | null;
  vat: number | null;
  /** Tags 6-8 present: hashed and signed (Phase 2), not just a Phase 1 stamp. */
  signed: boolean;
}

/** Ibtekar's VAT registration number, as their invoices print it. */
export const IBTEKAR_VAT = '311669902800003';

function base64Bytes(text: string): Uint8Array | null {
  const t = text.trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(t) || t.length < 20) return null;
  try {
    const bin = atob(t.replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/** The fields of a ZATCA QR code, or null when the text is not one. */
export function decodeZatcaQr(text: string): ZatcaQr | null {
  const bytes = base64Bytes(text);
  if (!bytes) return null;
  const fields = new Map<number, Uint8Array>();
  let i = 0;
  while (i + 2 <= bytes.length) {
    const tag = bytes[i], len = bytes[i + 1];
    if (i + 2 + len > bytes.length) return null;
    fields.set(tag, bytes.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  if (i !== bytes.length) return null;
  const str = (t: number) => (fields.has(t) ? new TextDecoder().decode(fields.get(t)) : '');
  const money = (t: number) => {
    const n = Number(str(t).replace(/,/g, ''));
    return str(t) && Number.isFinite(n) ? n : null;
  };
  // Tags 1 to 5 are the minimum ZATCA asks of every simplified or standard invoice.
  if (![1, 2, 3, 4, 5].every(t => fields.has(t))) return null;
  const vatNo = str(2);
  if (!/^3\d{13}3$/.test(vatNo)) return null;
  return {
    seller: str(1),
    vatNo,
    timestamp: str(3),
    total: money(4),
    vat: money(5),
    signed: [6, 7, 8].every(t => fields.has(t)),
  };
}
