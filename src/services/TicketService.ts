import {
  collection, doc, setDoc, deleteDoc,
  writeBatch, onSnapshot, query, where, Query,
} from 'firebase/firestore';
import { db } from '../utils/firebase';
import { Ticket } from '../types';
import { BalanceTopUp } from '../types';

export class TicketService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  subscribe(onData: (tickets: Ticket[]) => void, onError?: (e: Error) => void) {
    const q = query(collection(db, 'tickets'), where('userId', '==', this.userId));
    return onSnapshot(q, snap => {
      onData(snap.docs.map(d => d.data() as Ticket));
    }, err => onError?.(err as Error));
  }

  async saveImport(
    newTickets: Ticket[],
    updateTickets: Ticket[],
    topUpTickets: Ticket[],
    vendorBalancesLive: { id: string; vendorName: string }[]
  ): Promise<{ saved: number; updated: number; topups: number }> {
    const batch = writeBatch(db);

    // Real tickets
    newTickets.forEach(ticket => {
      const ref = doc(db, 'tickets', ticket.id);
      const toWrite: Record<string, unknown> = {
        id:              ticket.id,
        ticketNo:        ticket.ticketNo,
        source:          ticket.source || '',
        date:            ticket.date || '',
        amount:          ticket.amount ?? 0,
        commission:      ticket.commission ?? 0,
        totalDoc:        ticket.totalDoc ?? 0,
        reqNum:          ticket.reqNum || '',
        pnr:             ticket.pnr || '',
        passengerName:   ticket.passengerName || '',
        airlineCode:     ticket.airlineCode || '',
        route:           ticket.route || '',
        status:          ticket.status || '',
        currency:        ticket.currency || 'SAR',
        transactionType: ticket.transactionType || ticket.status || '',
        vendorReference: ticket.vendorReference || '',
        reportName:      ticket.reportName || '',
        importTime:      ticket.importTime || new Date().toISOString(),
        isDuplicate:     false,
        userId:          this.userId,
        createdAt:       new Date().toISOString(),
        // New fields from roadmap
        balanceAfter:    ticket.balanceAfter ?? null,
      };
      batch.set(ref, toWrite);
    });

    // Req num updates
    updateTickets.forEach(ticket => {
      const ref = doc(db, 'tickets', ticket.id);
      batch.set(ref, { reqNum: ticket.reqNum }, { merge: true });
    });

    // TopUp rows → save as BalanceTopUp
    topUpTickets.forEach(t => {
      const vendor = vendorBalancesLive.find(v =>
        t.source.toLowerCase().includes(v.vendorName.toLowerCase()) ||
        v.vendorName.toLowerCase().includes(t.source.toLowerCase())
      );
      if (!vendor) return;
      const id = `topup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const ref = doc(db, 'balanceTopUps', id);
      batch.set(ref, {
        id,
        vendorId:   vendor.id,
        vendorName: vendor.vendorName,
        amount:     t.amount,
        note:       `Auto top-up from ${t.reportName || t.source}`,
        date:       t.date || new Date().toISOString().split('T')[0],
        userId:     this.userId,
      } as BalanceTopUp);
    });

    await batch.commit();
    return { saved: newTickets.length, updated: updateTickets.length, topups: topUpTickets.length };
  }

  async delete(ticketId: string): Promise<void> {
    await deleteDoc(doc(db, 'tickets', ticketId));
  }

  async updateReqNum(ticketId: string, reqNum: string): Promise<void> {
    await setDoc(doc(db, 'tickets', ticketId), { reqNum }, { merge: true });
  }
}
