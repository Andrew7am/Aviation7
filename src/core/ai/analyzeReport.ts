import { GoogleGenAI } from '@google/genai';
import { validateProfileDraft, PROFILE_FIELDS, LearnedColumns, LearnedRules } from './learnedProfile';

/**
 * Server-side only (called from api/ai/analyze-report.ts on Vercel and the
 * same route in server.ts locally — the Gemini key never reaches the browser).
 *
 * Sends the unknown report's headers + a small sample of rows to Gemini ONCE,
 * gets back a strict-JSON column mapping, and validates it against the real
 * headers before anything is saved. The caller persists the result as a
 * LearnedProfile; all future parsing of this format is deterministic.
 */

export interface AnalyzeResult {
  vendorName: string;
  isLCC: boolean;
  columns: LearnedColumns;
  rules: LearnedRules;
  aiWarnings: string[];
}

const PROMPT_INTRO = `You are the column-mapping brain of a travel-agency reconciliation ERP.
A new vendor report has arrived in a layout the system has never seen. Your job is
exactly what a human integrator does: work out which column holds which field, so
the report can be parsed deterministically forever after.

HOW TO DECIDE — judge a column by the SHAPE OF ITS VALUES first and its header
second. Headers lie: they get renamed, abbreviated, translated, left blank, or
duplicated. Values do not.

  ticket     13-15 digit document number, often written "123-4567890123" or
             "065 - 6905958893". The first 3 digits are the airline code.
             NOT the booking id, NOT the invoice number.
  pnr        record locator: 5-6 chars, letters+digits, e.g. "8SX9OF", "YB7LJY".
  passenger  a person's name, usually "SURNAME/GIVEN NAMES" or "GIVEN/SURNAME".
  date       the ISSUE / transaction date. If several date columns exist, pick
             the one for when the document was issued, NOT the travel/departure
             date and NOT the booking-created date.
  amount     ONE signed column where negative already means refund.
  debit      / credit — use this PAIR instead when the vendor keeps two columns.
  total      gross document value, when it is separate from the net.
  commission the agency's commission. Typically 0-20% of the total.
  status     the transaction-type word: issd/issue/TKTT, rfnd/rfndp/refund/RFND,
             void/CANX/CANN/RFNX, EMD, ADM, ACM.
  currency   3-letter code (AED, SAR, USD...).
  route      airport pairs: "JED-RUH", "RUH-LHR-RUH", "AHB/JED/MED/JED/AHB".
             MUST look like 3-letter airport codes joined by - or /.
  req        the AGENCY'S OWN internal request number, the thing they reconcile
             against. Looks like "SA 1109", "KSAML1331", "REQ 10333", "R-147".
             This is usually a column the agency ADDED to the vendor's export.

TRAPS THAT HAVE CAUSED REAL LOSSES HERE — check each one before answering:
  1. Do NOT map an invoice/LPO number ("INV-26-01-0565", "RFD-26-01-0347") to
     route. Those are references, not itineraries. If nothing looks like airport
     codes, return null for route.
  2. Do NOT map the vendor's own booking reference or file number to req. req is
     the agency's number. If two candidates exist, prefer the one whose values do
     NOT also appear in another column.
  3. Do NOT confuse tax with commission. If a column equals the tax column value
     for value, it is tax mislabelled — return null for commission rather than
     mapping it.
  4. Reports repeat columns (the PNR often appears twice, once near the start and
     once near the end). Map the FIRST occurrence.
  5. A column of "true/false", a username, an office id or an agency name is never
     one of these fields.

Also determine:
  vendorName    short human name for this vendor/format, from context in the data
                (an airline name, a carrier code, an agency/consolidator name).
  isLCC         true when the report has NO real ticket numbers and the PNR is the
                only row identifier.
  rules.refund  how a refund is expressed in THIS format:
                "negative_amount" — the amount column goes negative
                "credit_column"   — a separate credit column is filled
                "status_column"   — only the status word says so

Answer with the EXACT header text for each field, copied character for character
from the HEADERS list, or null when the format genuinely has no such column.
Never invent a header that is not in the list. Prefer null over a bad guess: a
wrong mapping silently corrupts the ledger, a null just means the field is empty.

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{"vendorName": string, "isLCC": boolean, "columns": {${PROFILE_FIELDS.map(f => `"${f}": string|null`).join(', ')}}, "rules": {"refund": string}}`;

/** Per-column digest: header text plus a few distinct sample values. Far more
 *  useful to the model than raw rows, because the decisive evidence for
 *  "which column is this" is what the column CONTAINS, and a row-wise dump
 *  makes the model count commas to line values up with headers. */
function describeColumns(headers: string[], sampleRows: string[][]): string {
  return headers.map((h, i) => {
    const seen = new Set<string>();
    for (const row of sampleRows) {
      const v = (row[i] ?? '').toString().trim();
      if (v && seen.size < 5) seen.add(v.slice(0, 40));
    }
    const samples = [...seen];
    const label = (h ?? '').toString().trim() || '(no header)';
    return `[${i}] "${label}" -> ${samples.length ? samples.map(s => JSON.stringify(s)).join(', ') : '(always empty)'}`;
  }).join('\n');
}

export async function analyzeReportWithAI(
  headers: string[],
  sampleRows: string[][],
  apiKey: string,
): Promise<AnalyzeResult> {
  const ai = new GoogleGenAI({ apiKey });

  const sample = sampleRows.slice(0, 15).map(r => r.map(v => (v ?? '').slice(0, 60)));
  const prompt = `${PROMPT_INTRO}

HEADERS (${headers.length} columns) — copy these EXACTLY when answering:
${JSON.stringify(headers)}

COLUMN BY COLUMN (header, then distinct values actually seen in that column):
${describeColumns(headers, sample)}

FULL SAMPLE ROWS, for cross-checking how the columns line up:
${sample.map(r => JSON.stringify(r)).join('\n')}`;

  // 503 "high demand" spikes from Gemini are common and transient — retry
  // with backoff before surfacing an error to the user. Model overridable
  // via env (GEMINI_MODEL) without a code change.
  // 'gemini-flash-latest' is Google's stable alias for the current flash
  // model — the pinned name the original AI Studio scaffold used isn't
  // available to standard API keys.
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/503|UNAVAILABLE|overloaded|high demand|429/i.test(msg) || attempt === 4) throw err;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  if (!response) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

  const text = (response.text ?? '').trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
  let draft: unknown;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error(`AI returned unparseable output: ${text.slice(0, 200)}`);
  }

  const validated = validateProfileDraft(draft as Record<string, unknown>, headers);
  if ('errors' in validated) {
    throw new Error(`AI mapping rejected: ${validated.errors.join(' · ')}`);
  }
  return { ...validated.profile, aiWarnings: validated.warnings };
}
