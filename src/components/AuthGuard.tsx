import React, { useState, useEffect } from 'react';
import { Plane, LogIn } from 'lucide-react';
import { loginWithGoogle, supabase } from '../utils/supabase';
import type { User } from '@supabase/supabase-js';

interface AuthGuardProps {
  children: (user: User) => React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="keep-palette h-[100dvh] bg-[#111C2D] dark:bg-[#111111] flex items-center justify-center" role="status" aria-label="Loading">
        <div className="w-5 h-5 rounded-full border-2 border-[#304158] border-t-[#C6A15B] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      /* The sign-in page: the brand at its plainest - midnight navy, the plane
         in gold, the name. No blurred shapes behind it: a finance tool's
         front door should look like one. */
      <div className="keep-palette min-h-[100dvh] bg-[#111C2D] dark:bg-[#111111] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-sm bg-[#19263A] border border-[#304158] dark:bg-[#1A1A1A] dark:border-[#2E2E2E] rounded-xl shadow-2xl overflow-hidden">
          <div className="h-1 bg-[#C6A15B]" aria-hidden="true" />
          <div className="px-8 pt-9 pb-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-xl bg-[#111C2D] dark:bg-[#111111] ring-1 ring-[#C6A15B]/50 flex items-center justify-center mb-6">
              <Plane className="w-7 h-7 text-[#C6A15B]" />
            </div>
            <h1 className="text-lg font-extrabold tracking-[0.18em] uppercase text-[#E8EDF4]">Luxury Explorers</h1>
            <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#C6A15B]">Travel Accounting ERP</p>
            <p className="mt-5 text-sm text-[#B0BDCE]">Reconciliation &amp; audit portal</p>

            <button
              onClick={() => loginWithGoogle()}
              className="mt-8 w-full h-11 bg-[#3A72BD] hover:bg-[#4A85D4] dark:bg-[#2563EB] dark:hover:bg-[#3B76F0] text-white font-semibold rounded-md
                         transition-colors text-sm flex items-center justify-center gap-2
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
            >
              <LogIn className="w-4 h-4" />
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children(user)}</>;
}
