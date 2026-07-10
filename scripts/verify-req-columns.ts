import Papa from 'papaparse';
import { runParser } from '../src/core/parsers';

// Simulate the user's workflow: they add a "Req Number" column (that they fill
// in themselves) to a vendor report that previously had NO req the parser
// could read from a name. Test the two hardest cases:
//   - NSA: previously only matched the literal header "Request Number"
//   - Gold Medal: previously read a FIXED column position (5), ignoring names
// Plus a normal case (Flynas) to confirm the existing req still resolves.

function run(label: string, csv: string, expectReq: Record<string, string>) {
  const rows = Papa.parse(csv.trim(), { skipEmptyLines: true }).data as string[][];
  const src = label.split(' ')[0];
  const { rows: parsed } = runParser(rows, src, 'SAR', src);
  console.log(`\n=== ${label} → ${parsed.length} rows ===`);
  let ok = true;
  for (const [tkFragment, wantReq] of Object.entries(expectReq)) {
    const t = parsed.find(r => r.ticketNo.includes(tkFragment) || (r.pnr || '').includes(tkFragment));
    const got = t?.reqNum ?? '(row not found)';
    const pass = got === wantReq;
    ok = ok && pass;
    console.log(`  ${pass ? 'OK ' : 'FAIL'} ${tkFragment} → req="${got}" (want "${wantReq}")`);
  }
  if (!ok) throw new Error(`${label} failed`);
}

// NSA: its req lives in the existing "Request Number" column — confirm it
// still reads unchanged (regression, no user column added).
run('NSA existing req', [
  'DATE,notes,EVENT MONTH,LPO NUMBER,Operator name,Request Number,Doc No,Description,PNR,DEBIT (SAR),Credit (SAR)',
  '2025-06-02,,JUNE,International,,SA 712,157 - 2899436427,ALSHIDDI/RANA,Y6W6EM,12968,',
].join('\n'), { '2899436427': 'SA712' });

// Gold Medal + a user-added "Req Number" column. Gold Medal has NO named req
// column normally (it reads a fixed position / city-name heuristic), so this
// is the real case where adding a Req column must take over.
run('Gold user-added Req column', [
  'Customer No,Name,Transaction_Type,Invoice Number,Invoice Date,City,Passenger Name,PO Number,Curr,Original Amount,Balance Due,Status,Routing,Ticket Number,Req Number',
  'DTL902,Lux,INV,22813217,2026-04-24,Dubai,MOHAMED/IBRAHIM,BKR-2026-111454,AED,1970,0,CLOSED,Dubai-Cairo,4815040418(1 PAX),SA 8001',
].join('\n'), { '4815040418': 'SA8001' });

// RTS + a user-added "Req Number" column. RTS's req is normally an unlabeled
// fixed column — an explicit Req column must win.
run('RTS user-added Req column', [
  'PNR creation date,Record Locator,Passenger,No,Extra,Action,Total,Total currency,Req Number',
  '2026-04-29,8PTDHK,SMITH CHRISTOPHER,220-5512605725,ksaco379,issue,15560,AED,SA 7001',
].join('\n'), { '8PTDHK': 'SA7001' });

// Flynas normal (existing REQ. NUMBER column) — must still resolve unchanged
run('Flynas existing req', [
  'Date,PNR2,pax,AMOUNT,REQ. NUMBER,balance,Column6,Status',
  '2025-09-21,FHLQGE,MANSOUR/GIHAN,429,REQ 11160,6001,international,',
].join('\n'), { 'FHLQGE': 'REQ11160' });

console.log('\nALL USER-REQ CHECKS PASSED');
