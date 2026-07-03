import { collection, doc, setDoc, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../utils/firebase';

export interface ImportRecord {
  id:          string;
  userId:      string;
  vendor:      string;
  reportName:  string;
  parserName:  string;
  confidence:  number;
  totalRows:   number;
  imported:    number;
  updated:     number;
  topups:      number;
  failed:      number;
  warnings:    number;
  duration:    number;   // ms
  importedAt:  string;
}

export interface AuditEntry {
  id:         string;
  userId:     string;
  action:     'IMPORT' | 'UPDATE_REQ' | 'DELETE' | 'TOPUP' | 'ADD_VENDOR' | 'DELETE_VENDOR';
  entity:     string;   // ticketNo / vendorName / etc
  detail:     string;
  performedAt: string;
}

export interface ErrorEntry {
  id:        string;
  userId:    string;
  vendor:    string;
  rowNumber: number;
  rawData:   string;
  error:     string;
  importId:  string;
  loggedAt:  string;
}

export class ImportService {
  private userId: string;

  constructor(userId: string) { this.userId = userId; }

  async saveImportRecord(record: Omit<ImportRecord, 'id' | 'userId' | 'importedAt'>): Promise<string> {
    const id  = `import_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const doc_ = doc(db, 'importHistory', id);
    const entry: ImportRecord = { ...record, id, userId: this.userId, importedAt: new Date().toISOString() };
    await setDoc(doc_, entry);
    return id;
  }

  async saveErrors(importId: string, vendor: string, errors: { row: number; raw: string; error: string }[]): Promise<void> {
    for (const e of errors) {
      const id = `err_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
      await setDoc(doc(db, 'errorLog', id), {
        id, userId: this.userId, vendor, rowNumber: e.row,
        rawData: e.raw.substring(0, 300), error: e.error,
        importId, loggedAt: new Date().toISOString(),
      } as ErrorEntry);
    }
  }

  async audit(action: AuditEntry['action'], entity: string, detail: string): Promise<void> {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
    await setDoc(doc(db, 'auditLog', id), {
      id, userId: this.userId, action, entity, detail,
      performedAt: new Date().toISOString(),
    } as AuditEntry);
  }

  subscribeHistory(onData: (records: ImportRecord[]) => void, maxItems = 50) {
    const q = query(
      collection(db, 'importHistory'),
      where('userId', '==', this.userId),
      orderBy('importedAt', 'desc'),
      limit(maxItems)
    );
    return onSnapshot(q, snap => onData(snap.docs.map(d => d.data() as ImportRecord)));
  }

  subscribeErrors(importId: string, onData: (errors: ErrorEntry[]) => void) {
    const q = query(collection(db, 'errorLog'), where('importId', '==', importId));
    return onSnapshot(q, snap => onData(snap.docs.map(d => d.data() as ErrorEntry)));
  }
}
