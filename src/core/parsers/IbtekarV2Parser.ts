import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk, pnrClean } from './shared';
import { airlineNumeric } from '../config/airlines';
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
 *
 * Their site prints a second copy of the same report (October 2026 on):
 * "Date" for "Tk Date", "Action" - issue / refund / void - for "Status",
 * "Grand Total" with a space, and a "Type" column saying ticket or EMD.
 * Same rows, same offices, same money; read by the same parser, so the two
 * copies of one ticket are one ticket.
 *
 * Except RTS Dubai's: the same booking system prints the same copy for them,
 * column for column. The office that issued the ticket is the difference -
 * "OfficeID Tk" reads RUH… for Ibtekar in Riyadh (RUHS2234T) and DXB… for RTS
 * in Dubai (DXBDN38DA) - so each row is filed under the vendor its office
 * belongs to, and priced in the currency its own money cells state.
 */
export function vendorForOffice(office: string): '' | 'Ibtekar' | 'RTS' {
  const o = (office || '').trim().toUpperCase();
  if (o.startsWith('RUH')) return 'Ibtekar';
  if (o.startsWith('DXB')) return 'RTS';
  return '';
}

/** "3320.00 AED" -> "AED". */
const currencyIn = (raw: string) => (/\b(SAR|AED|USD|EUR|EGP)\b/i.exec(raw || '')?.[1] ?? '').toUpperCase();

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
    return (hj.includes('tkdate') || hj.split('|').includes('date')) && hj.includes('recloc')
      && hj.includes('grandtotal') && hj.includes('route');
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

    const iDate = col(headers, 'Tk Date', 'Date');
    const iPNR = col(headers, 'RecLoc');
    const iPax = col(headers, 'Passenger');
    const iTicket = col(headers, 'No');
    const iStatus = col(headers, 'Status', 'Action');
    // "ticket" or "EMD", in the newer copy only.
    const iType = headers.findIndex(h => (h || '').trim().toLowerCase() === 'type');
    const iVC = col(headers, 'VC');
    const iRoute = col(headers, 'Route');
    const iGrand = col(headers, 'GrandTotal', 'NGrandTotal', 'Total');
    const iFare = col(headers, 'Fare eq.', 'Fare');
    const iTaxes = col(headers, 'Taxes');
    const iExplicitReq = findExplicitReqColumn(headers);
    const iOfficeTk = col(headers, 'OfficeID Tk', 'Office ID Tk', 'OfficeIDTk');
    const iOfficeBk = col(headers, 'OfficeID Bk', 'Office ID Bk', 'OfficeIDBk');
    const offices = new Set<string>();

    if (iTicket === -1 || iStatus === -1 || iGrand === -1) {
      errors.push('Ibtekar (New): required columns missing (No / Status or Action / Grand Total).');
      return { rows: result, errors, warnings };
    }

    /* Their report prints 1970-01-01 - the zero date - on the second ticket
       of a booking: 8RPYVM's 593-4862343263 beside its 065-4862343264 of
       2026-10-06. That is their blank, not a ticket issued in 1970, so it
       takes the date of the booking's dated ticket. */
    const isEpoch = (d: string) => /^1970-01-0[12]$/.test(d) || !d;
    const bookingDate = new Map<string, string>();
    for (const row of rows) {
      const d = parseDate(cell(row, iDate));
      const pnr = pnrClean(cell(row, iPNR));
      if (pnr && d && !isEpoch(d) && !bookingDate.has(pnr)) bookingDate.set(pnr, d);
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
      if (/^issd|^issue|^exch|^reiss/.test(rawStatus)) status = 'ISSUE';
      else if (/^rfnd|^refund/.test(rawStatus)) status = 'REFUND';
      else if (/^(void|canx|cann|rfnx)/.test(rawStatus)) status = 'VOID';
      else if (/^emd/.test(rawStatus)) status = 'EMDS';
      else if (/^adm/.test(rawStatus)) status = 'ADM';
      else if (/^acm/.test(rawStatus)) status = 'ACM';
      else {
        warnings.push(`Ticket ${rawTk}: unknown status "${rawStatus}" — treating as ISSUE`);
        status = 'ISSUE';
      }
      // The newer copy says EMD in its own column rather than its action.
      if (status === 'ISSUE' && iType !== -1 && /^emd/i.test(cell(row, iType).trim())) status = 'EMDS';

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
      let date = parseDate(rawDate);
      if (isEpoch(date)) {
        const theirs = bookingDate.get(pnrClean(cell(row, iPNR)));
        if (theirs) date = theirs;
        else { date = ''; warnings.push(`Ticket ${cleanTk(rawTk)}: no date on Ibtekar's report (it reads ${rawDate || 'blank'})`); }
      }

      const tkClean = cleanTk(rawTk);
      const ac = airlineCode(rawTk);

      /**
       * Their "VC" column holds the validating carrier as a two-letter
       * designator - SV, MS, TK - and the ledger's airline column holds
       * the three-digit numeric code. Those are two different alphabets
       * for the same fact, and passing the letters straight through put
       * "SV" in a column every screen reads as a number.
       *
       * So it is translated. A designator we have not been given
       * translates to nothing rather than to a guess, and then the code
       * read off the ticket number is used instead - which for their
       * bare ten-digit documents is usually blank, and an honest blank
       * beats a wrong carrier.
       */
      const vc = iVC !== -1 ? cell(row, iVC) : '';
      const vcCode = airlineNumeric(vc);
      if (vc && !vcCode && !ac)
        warnings.push(`Ticket ${tkClean}: carrier "${vc.toUpperCase()}" is not a code we know`);
      const req = resolveReq(iExplicitReq !== -1 ? cell(row, iExplicitReq) : '');
      if (!req && !isVoid) warnings.push(`Ticket ${tkClean}: Missing Req Num`);

      // The issuing office decides the vendor; the booking office stands in
      // when a copy leaves the issuing one out.
      const office = (iOfficeTk !== -1 ? cell(row, iOfficeTk) : '') || (iOfficeBk !== -1 ? cell(row, iOfficeBk) : '');
      const vendor = vendorForOffice(office);
      if (office) offices.add(office.trim().toUpperCase());

      result.push({
        ticketNo: tkClean,
        pnr: pnrClean(cell(row, iPNR)),
        passengerName: cleanPax(cell(row, iPax)),
        airlineCode: vcCode || ac,
        route: cell(row, iRoute),
        date,
        amount,
        totalDoc: Math.abs(grand),
        commission: 0,
        reqNum: req,
        vendorReference: cell(row, iPNR),
        status,
        currency: (currencyIn(cell(row, iGrand)) || defaultCurrency) as typeof defaultCurrency,
        ...(vendor ? { source: vendor } : {}),
      });
    });

    // Said on the preview, because the screen's vendor box may say Ibtekar.
    const dubai = [...offices].filter(o => vendorForOffice(o) === 'RTS');
    if (dubai.length)
      warnings.push(`Issued from Dubai (${dubai.join(', ')}): ${result.filter(r => r.source === 'RTS').length} ticket(s) filed under RTS, not Ibtekar.`);
    const unknown = [...offices].filter(o => !vendorForOffice(o));
    if (unknown.length)
      warnings.push(`Office ${unknown.join(', ')} is neither Ibtekar's (RUH) nor RTS's (DXB) - those rows take the vendor chosen on the import screen.`);

    return { rows: result, errors, warnings };
  },
};
