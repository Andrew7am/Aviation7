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
  /**
   * Whether tag 7 is a good signature of tag 6 by the key in tag 8. False: the
   * code was altered, or never signed by that key. Null: not checked, or a
   * curve the browser has no way to check. It says the code is whole - not
   * that ZATCA accepted the invoice, which only their own systems can say.
   */
  signatureOk?: boolean | null;
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

function tlvFields(bytes: Uint8Array): Map<number, Uint8Array> | null {
  const fields = new Map<number, Uint8Array>();
  let i = 0;
  while (i + 2 <= bytes.length) {
    const tag = bytes[i], len = bytes[i + 1];
    if (i + 2 + len > bytes.length) return null;
    fields.set(tag, bytes.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return i === bytes.length ? fields : null;
}

/** A DER ECDSA signature as the two fixed halves WebCrypto takes. */
function derToRaw(der: Uint8Array, size = 32): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let at = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const out = new Uint8Array(size * 2);
  for (let part = 0; part < 2; part++) {
    if (der[at] !== 0x02) return null;
    const len = der[at + 1];
    let v = der.subarray(at + 2, at + 2 + len);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    if (v.length > size) return null;
    out.set(v, part * size + size - v.length);
    at += 2 + len;
  }
  return out;
}

/* Tags 6 and 7 are base64 text, tag 8 the key's own bytes, as Ibtekar's
   carry them; either may come raw. */
const maybeBase64 = (b: Uint8Array) => base64Bytes(new TextDecoder().decode(b)) ?? b;

/** Check a QR code's signature: see ZatcaQr.signatureOk. */
export async function verifyZatcaSignature(text: string): Promise<boolean | null> {
  const bytes = base64Bytes(text);
  const fields = bytes && tlvFields(bytes);
  if (!fields || ![6, 7, 8].every(t => fields.has(t))) return null;
  const raw = derToRaw(maybeBase64(fields.get(7)!));
  if (!raw) return false;
  try {
    const key = await crypto.subtle.importKey('spki', fields.get(8)! as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw as BufferSource, maybeBase64(fields.get(6)!) as BufferSource);
  } catch {
    return null;   // not a P-256 key: nothing here can check it
  }
}

/** The fields of a ZATCA QR code, or null when the text is not one. */
export function decodeZatcaQr(text: string): ZatcaQr | null {
  const bytes = base64Bytes(text);
  if (!bytes) return null;
  const fields = tlvFields(bytes);
  if (!fields) return null;
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
