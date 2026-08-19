import { VendorParser, ParserResult } from './types';
import { IATAParser } from './IATAParser';
import { NSAParser } from './NSAParser';
import { FlyAdealDXBParser } from './FlyAdealDXBParser';
import { FlyAdealKSAParser } from './FlyAdealKSAParser';
import { IbtekarParser } from './IbtekarParser';
import { IbtekarV2Parser } from './IbtekarV2Parser';
import { GoldMedalParser } from './GoldMedalParser';
import { AirArabiaParser } from './AirArabiaParser';
import { FlynasParser } from './FlynasParser';
import { FlyDubaiParser } from './FlyDubaiParser';
import { RTSParser } from './RTSParser';
import { RiyadhAirParser } from './RiyadhAirParser';
import { TurkishAirlinesParser } from './TurkishAirlinesParser';
import { ReconciliationExportParser } from './ReconciliationExportParser';
import { BSPInvoiceParser } from './BSPInvoiceParser';
import { SupportedCurrency } from '../helpers/resolveCurrency';
import { findHeaderRow } from '../helpers/columnResolver';
import { makeProfileParser } from './ProfileParser';
import { LearnedProfile, headerFingerprint, bestHeaderRowForAI } from '../ai/learnedProfile';

export const ALL_PARSERS: VendorParser[] = [
  // Our own export comes first: it is the most specific signature and must
  // win before any vendor parser gets a chance to half-match it.
  ReconciliationExportParser,
  // BSP settlement invoice (PDF) — checked before the TJQ parser so a
  // settlement document is never mistaken for a daily sales report.
  BSPInvoiceParser,
  IATAParser, NSAParser,
  FlyAdealDXBParser, FlyAdealKSAParser,
  IbtekarV2Parser, IbtekarParser, GoldMedalParser,
  AirArabiaParser, FlynasParser,
  FlyDubaiParser, RTSParser,
  RiyadhAirParser, TurkishAirlinesParser,
];

export interface SmartDetectResult {
  parser:     VendorParser | null;
  confidence: number;      // 0–100
  missingCols: string[];   // columns we expected but didn't find
  headerRowIdx: number;
}

/** Detect which parser fits + confidence score */
export function smartDetect(
  allRows: string[][],
  defaultSource?: string,
  learnedProfiles: LearnedProfile[] = []
): SmartDetectResult {
  const headerRowIdx = findHeaderRow(allRows);
  const headers = allRows[headerRowIdx];

  // 1. Try auto-detect by signals
  for (const parser of ALL_PARSERS) {
    if (parser.detect(headers)) {
      return { parser, confidence: 95, missingCols: [], headerRowIdx };
    }
  }

  // 2. Learned AI profile — exact header fingerprint match means this exact
  //    format was analyzed before; parsing is deterministic from here on.
  //    Must probe the same candidate header rows the AI analysis flow uses
  //    (signal-based pick, then density fallback), or a profile learned on a
  //    file with title rows above the header would never match again.
  if (learnedProfiles.length > 0) {
    const candidates = [headerRowIdx, bestHeaderRowForAI(allRows, headerRowIdx)];
    for (const idx of [...new Set(candidates)]) {
      const fp = headerFingerprint(allRows[idx]);
      const learned = learnedProfiles.find(p => p.fingerprint === fp);
      if (learned) {
        return { parser: makeProfileParser(learned), confidence: 90, missingCols: [], headerRowIdx: idx };
      }
    }
  }

  // 3. Try by defaultSource name match
  if (defaultSource) {
    const ds = defaultSource.toUpperCase().replace(/\s+/g, '');
    const found = ALL_PARSERS.find(p =>
      p.id === ds ||
      p.name.toUpperCase().replace(/\s+/g,'').includes(ds) ||
      ds.includes(p.id)
    );
    if (found) return { parser: found, confidence: 60, missingCols: [], headerRowIdx };
  }

  return { parser: null, confidence: 0, missingCols: [], headerRowIdx };
}

/** Run the right parser, falling back to ImportEngine regex */
export function runParser(
  allRows: string[][],
  defaultSource?: string,
  defaultCurrency: SupportedCurrency = 'SAR',
  reportName?: string,
  learnedProfiles: LearnedProfile[] = []
): ParserResult & { parserName: string; confidence: number } {
  const { parser, confidence, headerRowIdx } = smartDetect(allRows, defaultSource, learnedProfiles);

  if (!parser) {
    return {
      rows: [], errors: [`Could not detect vendor format. Use "Analyze with AI" to map this format once, or select the source manually.`],
      warnings: [], parserName: 'Unknown', confidence: 0,
    };
  }

  const headers  = allRows[headerRowIdx];
  // Headerless vendors (pure-data exports) must keep row 0 — slicing it off
  // as a header row would silently drop a real transaction.
  const dataRows = (parser.headerless ? allRows : allRows.slice(headerRowIdx + 1))
    .filter(r => r.some(c => c?.trim()));
  const result   = parser.parse(dataRows, headers, defaultCurrency, defaultSource);

  return { ...result, parserName: parser.name, confidence };
}
