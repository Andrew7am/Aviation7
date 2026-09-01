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
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}
