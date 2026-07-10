import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { Ticket } from '../types';
import { runParser } from '../core/parsers';
import { detectDuplicates, detectDuplicatesAgainstExisting, readFileAsText } from '../core/ImportEngine';
import { SupportedCurrency } from '../core/helpers/resolveCurrency';
import { LearnedProfile } from '../core/ai/learnedProfile';
import { v4 as uuidv4 } from 'uuid';

export interface ImportErrorEntry { row: number; raw: string; error: string }

export interface ImportPreview {
  fresh:       Ticket[];
  updates:     Ticket[];
  duplicates:  Ticket[];
  topUps:      Ticket[];
  errors:      ImportErrorEntry[];
  warnings:    string[];
  parserName:  string;
  confidence:  number;
  totalRows:   number;
}

export interface ImportMeta {
  parserName: string;
  confidence: number;
  totalRows:  number;
  warnings:   number;
  errors:     ImportErrorEntry[];
  vendor:     string;
  reportName: string;
}

/**
 * useImport — single source of truth for the import preview/validation flow.
 * Used by ImportData.tsx so the parsing + duplicate-detection logic lives in one place.
 */
export function useImport(existingTickets: Ticket[]) {
  const [preview,   setPreview]   = useState<ImportPreview | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [inputText, setInputText] = useState('');

  const runValidation = useCallback((
    text:            string,
    defaultSource?:  string,
    defaultCurrency: SupportedCurrency = 'SAR',
    reportName?:     string,
    learnedProfiles: LearnedProfile[] = []
  ) => {
    if (!text.trim()) {
      setPreview({
        fresh: [], updates: [], duplicates: [], topUps: [],
        errors: [{ row: 0, raw: '', error: 'Please enter some data.' }],
        warnings: [], parserName: '', confidence: 0, totalRows: 0,
      });
      return;
    }
    setLoading(true);

    try {
      const allRows = Papa.parse(text.trim(), { skipEmptyLines: true }).data as string[][];
      const { rows, errors, warnings, parserName, confidence } = runParser(
        allRows, defaultSource, defaultCurrency, reportName, learnedProfiles
      );

      const rawTickets: Ticket[] = rows.map(r => ({
        id:              uuidv4(),
        ticketNo:        r.ticketNo,
        pnr:             r.pnr || '',
        passengerName:   r.passengerName || '',
        airlineCode:     r.airlineCode || '',
        route:           r.route || '',
        source:          defaultSource || parserName,
        date:            r.date,
        amount:          r.amount,
        totalDoc:        r.totalDoc || Math.abs(r.amount),
        commission:      r.commission || 0,
        reqNum:          r.reqNum,
        vendorReference: r.vendorReference || '',
        status:          r.status,
        currency:        r.currency,
        serial:          r.serial,
        transactionType: r.status,
        reportName:      reportName || defaultSource || parserName,
        importTime:      new Date().toISOString(),
        isDuplicate:     false,
        userId:          'temp',
      }));

      const topUps   = rawTickets.filter(t => t.status === 'FUND');
      const realTkts = detectDuplicates(rawTickets.filter(t => t.status !== 'FUND'));
      const { fresh, updates, duplicates } = detectDuplicatesAgainstExisting(realTkts, existingTickets);

      setPreview({
        fresh, updates, duplicates, topUps,
        errors: errors.map((e, i) => ({ row: i, raw: e, error: e })),
        warnings, parserName, confidence,
        totalRows: allRows.length,
      });
    } finally {
      setLoading(false);
    }
  }, [existingTickets]);

  const clear = useCallback(() => {
    setPreview(null);
    setInputText('');
  }, []);

  /** Build the meta object handleImport needs, once the user confirms */
  const buildMeta = useCallback((defaultSource: string): ImportMeta | null => {
    if (!preview) return null;
    const vendor = defaultSource === 'Auto-detect' ? preview.parserName : defaultSource;
    return {
      parserName: preview.parserName,
      confidence: preview.confidence,
      totalRows:  preview.totalRows,
      warnings:   preview.warnings.length,
      errors:     preview.errors,
      vendor,
      reportName: vendor,
    };
  }, [preview]);

  return {
    preview, loading, inputText, setInputText,
    runValidation, readFileAsText, clear, buildMeta,
  };
}
