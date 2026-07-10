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

const PROMPT_INTRO = `You are a column-mapping engine for airline/travel vendor accounting reports.
You are given the header row and sample data rows of a report from a travel vendor
(airline, consolidator, or GDS). Identify which header corresponds to each field.

Fields (map to the EXACT header text as given, or null if absent):
- ticket:     the ticket/document number column (long numeric, often "123-4567890123")
- pnr:        booking reference / record locator (5-6 char alphanumeric)
- passenger:  passenger/customer name
- date:       transaction/issue/payment date
- amount:     a single signed amount column (negative = refund), if the format has one
- debit:      debit column, if the format uses a debit/credit pair instead
- credit:     credit column of that pair
- total:      gross/total document amount if separate from net
- commission: commission column
- status:     transaction type/status column (issue/refund/void...)
- currency:   currency code column
- route:      route/sector/itinerary column
- req:        the agency's internal request/reference number column (values like "SA 1109", "KSAML1331", "REQ 10333")

Also determine:
- vendorName: short human name for this vendor/format (from context clues in the data)
- isLCC:      true if this report has NO real ticket numbers and the PNR is the row identifier
- rules.refund: how refunds appear — "negative_amount" | "credit_column" | "status_column"

Respond with ONLY valid JSON, no markdown fences, matching exactly:
{"vendorName": string, "isLCC": boolean, "columns": {${PROFILE_FIELDS.map(f => `"${f}": string|null`).join(', ')}}, "rules": {"refund": string}}`;

export async function analyzeReportWithAI(
  headers: string[],
  sampleRows: string[][],
  apiKey: string,
): Promise<AnalyzeResult> {
  const ai = new GoogleGenAI({ apiKey });

  const sample = sampleRows.slice(0, 15).map(r => r.map(v => (v ?? '').slice(0, 60)));
  const prompt = `${PROMPT_INTRO}

HEADERS (${headers.length} columns):
${JSON.stringify(headers)}

SAMPLE ROWS:
${sample.map(r => JSON.stringify(r)).join('\n')}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

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
