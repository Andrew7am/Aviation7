import { useState, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { Ticket } from '../types';
import { runParser } from '../core/parsers';
import { detectDuplicates, detectDuplicatesAgainstExisting, classifyAgainstExisting, ClassifiedRow, readFileAsText } from '../core/ImportEngine';
import { SupportedCurrency } from '../core/helpers/resolveCurrency';
import { LearnedProfile } from '../core/ai/learnedProfile';
import { v4 as uuidv4 } from 'uuid';
import { TicketService } from '../services/TicketService';

export interface ImportErrorEntry { row: number; raw: string; error: string }

export interface ImportPreview {
  fresh:       Ticket[];
  updates:     Ticket[];
  duplicates:  Ticket[];
  topUps:      Ticket[];
  /** Invoice lines landing on a document the portal already recorded. They
   *  update that row's money rather than adding a second row for the sale. */
  settlements: Ticket[];
  errors:      ImportErrorEntry[];
  warnings:    string[];
  parserName:  string;
  confidence:  number;
  totalRows:   number;
  /** Per-row reconciliation verdict, for the preview only. The save path
   *  still goes through fresh/updates/duplicates above, unchanged. */
  classified:  ClassifiedRow[];
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
 * Accepts userId so it can query the DB directly for dup detection — this
 * avoids the race condition where the in-memory ticket list hasn't finished
 * loading yet when the user runs a preview.
 */
export function useImport(userId: string) {
  const [preview,   setPreview]   = useState<ImportPreview | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [inputText, setInputText] = useState('');

  const svc = useMemo(() => new TicketService(userId), [userId]);

  const runValidation = useCallback(async (
    text:            string,
    defaultSource?:  string,
    defaultCurrency: SupportedCurrency = 'SAR',
    reportName?:     string,
    learnedProfiles: LearnedProfile[] = []
  ) => {
    if (!text.trim()) {
      setPreview({
        fresh: [], updates: [], duplicates: [], topUps: [], settlements: [],
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
        // A row may name its own vendor (a multi-vendor re-import); only
        // fall back to the single source picked in the UI when it doesn't.
        source:          r.source || defaultSource || parserName,
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
        closed:          r.closed ?? false,
        channel:         r.channel,
        reportName:      reportName || defaultSource || parserName,
        importTime:      new Date().toISOString(),
        isDuplicate:     false,
        userId:          'temp',
      }));

      const topUps   = rawTickets.filter(t => t.status === 'FUND');
      const realTkts = detectDuplicates(rawTickets.filter(t => t.status !== 'FUND'));

      // Query DB for only the ticket numbers in this batch — always fresh,
      // no dependency on the in-memory list that may not have loaded yet.
      const batchTicketNos = rawTickets.map(t => t.ticketNo);
      const existingFromDB = await svc.fetchByTicketNos(batchTicketNos);

      const { fresh, updates, duplicates, settlements } = detectDuplicatesAgainstExisting(realTkts, existingFromDB);
      const classified = classifyAgainstExisting(realTkts, existingFromDB);

      setPreview({
        fresh, updates, duplicates, topUps, settlements,
        classified,
        errors: errors.map((e, i) => ({ row: i, raw: e, error: e })),
        warnings, parserName, confidence,
        totalRows: allRows.length,
      });
    } finally {
      setLoading(false);
    }
  }, [svc]);

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
