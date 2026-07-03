import { VendorParser, ParserResult } from './types';
import { IATAParser } from './IATAParser';
import { NSAParser } from './NSAParser';
import { FlyAdealDXBParser } from './FlyAdealDXBParser';
import { FlyAdealKSAParser } from './FlyAdealKSAParser';
import { IbtekarParser } from './IbtekarParser';
import { GoldMedalParser } from './GoldMedalParser';
import { AirArabiaParser } from './AirArabiaParser';
import { FlynasParser } from './FlynasParser';
import { FlyDubaiParser } from './FlyDubaiParser';
import { RTSParser } from './RTSParser';
import { SupportedCurrency } from '../helpers/resolveCurrency';
import { findHeaderRow } from '../helpers/columnResolver';

export const ALL_PARSERS: VendorParser[] = [
  IATAParser, NSAParser,
  FlyAdealDXBParser, FlyAdealKSAParser,
  IbtekarParser, GoldMedalParser,
  AirArabiaParser, FlynasParser,
  FlyDubaiParser, RTSParser,
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
  defaultSource?: string
): SmartDetectResult {
  const headerRowIdx = findHeaderRow(allRows);
  const headers = allRows[headerRowIdx];

  // 1. Try auto-detect by signals
  for (const parser of ALL_PARSERS) {
    if (parser.detect(headers)) {
      return { parser, confidence: 95, missingCols: [], headerRowIdx };
    }
  }

  // 2. Try by defaultSource name match
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
  reportName?: string
): ParserResult & { parserName: string; confidence: number } {
  const { parser, confidence, headerRowIdx } = smartDetect(allRows, defaultSource);

  if (!parser) {
    return {
      rows: [], errors: [`Could not detect vendor format. Please select source manually.`],
      warnings: [], parserName: 'Unknown', confidence: 0,
    };
  }

  const headers  = allRows[headerRowIdx];
  const dataRows = allRows.slice(headerRowIdx + 1).filter(r => r.some(c => c?.trim()));
  const result   = parser.parse(dataRows, headers, defaultCurrency, defaultSource);

  return { ...result, parserName: parser.name, confidence };
}
