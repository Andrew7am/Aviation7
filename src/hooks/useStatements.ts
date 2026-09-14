import { useState, useEffect, useMemo } from 'react';
import { VendorStatement } from '../types';
import { StatementService } from '../services/StatementService';

/** The vendors' own statements of account, live. */
export function useStatements(userId: string) {
  const [statements, setStatements] = useState<VendorStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const svc = useMemo(() => new StatementService(userId), [userId]);

  useEffect(() => svc.subscribe(s => { setStatements(s); setLoading(false); }), [svc]);

  return {
    statements,
    loading,
    saveStatement: (s: VendorStatement) => svc.save({ ...s, userId }),
    deleteStatement: (id: string) => svc.remove(id),
  };
}
