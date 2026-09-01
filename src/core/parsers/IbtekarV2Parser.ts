import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk, pnrClean } from './shared';
import { resolveReq, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';

/**
 * Ibtekar's new report format (2026-07 onward). Completely different columns
 * from the legacy IbtekarParser — this one is exported straight from the
 * booking system with per-ticket workflow status ("issd", "rfnd", "rfndp",
 * "void"), an already-formatted Route string, validating-carrier (VC) code,
 * and a "GrandTotal" money column formatted "778.55 SAR".
 *
 * Distinct headers we key on: "Tk Date" + "RecLoc" + "GrandTotal" — none of
 * which appear in the legacy Ibtekar sheet or any other vendor's export.
 */
export const IbtekarV2Parser: VendorParser = {
  id: 'IBTEKAR_V2',
  // The same vendor as the legacy sheet, not a second one. `name` becomes the
  // row's `source`, which is what decides the wallet a ticket is drawn against
  // and how the vendor reads in every report — so a new REPORT FORMAT must not
  // become a new VENDOR. Calling this "Ibtekar (New)" split one supplier into
  // two rows in the vendor list while both were still drawn from the single
  // Ibtekar wallet, because alias matching resolves on substrings.
  name: 'Ibtekar',
  detect: (headers) => {
    const hj = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9.]/g, '')).join('|');
    return hj.includes('tkdate') && hj.includes('recloc') && hj.includes('grandtotal') && hj.includes('route');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result = [];

    // sheet_to_json returns a SPARSE header array when the export has a blank
    // column in the middle (this format has a null between "No" and "Status").
    // findExplicitReqColumn's findIndex walks holes as undefined and crashes,
    // so densify with `?? ''` before any header lookup.
    headers = Array.from({ length: headers.length }, (_, i) => headers[i] ?? '');

    const iDate = col(headers, 'Tk Date');
    const iPNR = col(headers, 'RecLoc');
    const iPax = col(headers, 'Passenger');
    const iTicket = col(headers, 'No');
    const iStatus = col(headers, 'Status');
    const iVC = col(headers, 'VC');
    const iRoute = col(headers, 'Route');
    const iGrand = col(headers, 'GrandTotal', 'NGrandTotal', 'Total');
    const iFare = col(headers, 'Fare eq.', 'Fare');
    const iTaxes = col(headers, 'Taxes');
    const iExplicitReq = findExplicitReqColumn(headers);

    if (iTicket === -1 || iStatus === -1 || iGrand === -1) {
      errors.push('Ibtekar (New): required columns missing (No / Status / GrandTotal).');
      return { rows: result, errors, warnings };
    }

    rows.forEach((row, idx) => {
      const rawTk = cell(row, iTicket);
      if (!rawTk) {
        if (row.some(c => c?.trim())) errors.push(`Row ${idx + 2}: Ibtekar (New) - no ticket number`);
        return;
      }

      const rawStatus = cell(row, iStatus).toLowerCase().trim();
      // Normalize the raw workflow status into our internal set.
      // "issd" = issued, "rfnd"/"rfndp" = refund (partial refund still hits the
      // ledger as a refund), "void"/"cann"/"canx" = void, everything else
      // falls through to ISSUE with a warning so the row is never silently
      // dropped.
      let status: string;
      if (/^issd|^issue/.test(rawStatus)) status = 'ISSUE';
      else if (/^rfnd/.test(rawStatus)) status = 'REFUND';
      else if (/^(void|canx|cann|rfnx)/.test(rawStatus)) status = 'VOID';
      else if (/^emd/.test(rawStatus)) status = 'EMDS';
      else if (/^adm/.test(rawStatus)) status = 'ADM';
      else if (/^acm/.test(rawStatus)) status = 'ACM';
      else {
        warnings.push(`Ticket ${rawTk}: unknown status "${rawStatus}" — treating as ISSUE`);
        status = 'ISSUE';
      }

      // Money columns come formatted like "778.55 SAR" — num() strips the
      // suffix. Void rows carry the original grand total on the sheet, but
      // must not touch the ledger, so force amount to 0.
      const grand = num(cell(row, iGrand));
      const fare = iFare !== -1 ? num(cell(row, iFare)) : 0;
      const taxes = iTaxes !== -1 ? num(cell(row, iTaxes)) : 0;
      const isVoid = status === 'VOID';
      const isRef = status === 'REFUND';
      const amount = isVoid ? 0 : (isRef ? -Math.abs(grand) : Math.abs(grand));

      // "Tk Date" comes across as an Excel serial number (e.g. 46224) because
      // sheet_to_json returns numeric cells unparsed. parseDate() handles the
      // Excel-epoch conversion; falls back to string parse if it's already a
      // date string.
      const rawDate = cell(row, iDate);
      const date = parseDate(rawDate);

      const tkClean = cleanTk(rawTk);
      const ac = airlineCode(rawTk);
      const req = resolveReq(iExplicitReq !== -1 ? cell(row, iExplicitReq) : '');
      if (!req && !isVoid) warnings.push(`Ticket ${tkClean}: Missing Req Num`);

      result.push({
        ticketNo: tkClean,
        pnr: pnrClean(cell(row, iPNR)),
        passengerName: cleanPax(cell(row, iPax)),
        airlineCode: iVC !== -1 && cell(row, iVC) ? cell(row, iVC).toUpperCase() : ac,
        route: cell(row, iRoute),
        date,
        amount,
        totalDoc: Math.abs(grand),
        commission: 0,
        reqNum: req,
        vendorReference: cell(row, iPNR),
        status,
        currency: defaultCurrency,
      });
    });

    return { rows: result, errors, warnings };
  },
};
