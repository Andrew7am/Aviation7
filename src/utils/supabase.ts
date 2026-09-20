import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const loginWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });

export const logout = () => supabase.auth.signOut();

const PAGE_SIZE = 1000;

/**
 * PostgREST silently caps any select() at its configured max-rows (1000 on
 * Supabase) — no error, just a truncated result. Every full-table fetch in
 * this app must page through with .range() instead of relying on a single
 * select(), or rows past the cap silently vanish from the UI.
 *
 * `query` builds everything EXCEPT .range() (filters, .eq(), .order(), ...);
 * this helper appends .range() and keeps requesting pages until one comes
 * back short of PAGE_SIZE.
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) =>
    PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>
): Promise<T[]> {
  const first = await query(0, PAGE_SIZE - 1);
  if (first.error) throw new Error(first.error.message);
  const head = first.data ?? [];
  if (head.length < PAGE_SIZE) return head;

  // Past the first page the rest are fetched TOGETHER rather than one after
  // another. Each page is its own HTTP round trip and none of them depends on
  // the last, so waiting for page three before asking for page four spends
  // the whole table's latency in series: the ledger is six pages and the
  // audit log nineteen, which is nineteen round trips to open one screen.
  //
  // A caller that asks for `{ count: 'exact' }` tells us how many pages there
  // are, so every remaining one goes out at once. Without a count we cannot
  // know where the end is, so pages are fetched in parallel BATCHES and the
  // walk stops at the first short page - still parallel, and it never reads
  // past the end by more than one batch.
  const rest: T[][] = [];
  const total = first.count ?? null;

  if (total != null) {
    const pages: Promise<{ data: T[] | null; error: { message: string } | null }>[] = [];
    for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE)
      pages.push(Promise.resolve(query(from, from + PAGE_SIZE - 1)));
    for (const r of await Promise.all(pages)) {
      if (r.error) throw new Error(r.error.message);
      rest.push(r.data ?? []);
    }
  } else {
    const BATCH = 6;
    for (let from = PAGE_SIZE; ; from += PAGE_SIZE * BATCH) {
      const batch = await Promise.all(
        Array.from({ length: BATCH }, (_, i) =>
          Promise.resolve(query(from + i * PAGE_SIZE, from + (i + 1) * PAGE_SIZE - 1))));
      let ended = false;
      for (const r of batch) {
        if (r.error) throw new Error(r.error.message);
        const rows = r.data ?? [];
        rest.push(rows);
        if (rows.length < PAGE_SIZE) ended = true;
      }
      if (ended) break;
    }
  }

  return head.concat(...rest);
}
