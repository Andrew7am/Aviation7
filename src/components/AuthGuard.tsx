import React, { useState, useEffect } from 'react';
import { Plane, LogIn } from 'lucide-react';
import { loginWithGoogle, auth } from '../utils/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

interface AuthGuardProps {
  children: (user: User) => React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <div className="h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="w-4 h-4 bg-blue-500 rounded-full animate-ping"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen bg-[#0f172a] flex items-center justify-center font-sans text-white relative overflow-hidden">
        {/* Background visual */}
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-screen filter blur-3xl opacity-50 animate-blob"></div>
          <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-screen filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>
          <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-indigo-500 rounded-full mix-blend-screen filter blur-3xl opacity-50 animate-blob animation-delay-4000"></div>
        </div>

        <div className="z-10 bg-white/10 backdrop-blur-md p-10 rounded-2xl border border-white/20 shadow-2xl flex flex-col items-center max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg mb-6">
            <Plane className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight uppercase text-white mb-2">Luxury Explorers</h1>
          <p className="text-slate-400 text-sm mb-8">Reconciliation & Audit Portal</p>
          
          <button 
            onClick={loginWithGoogle}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded transition-colors uppercase tracking-widest text-xs flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return <>{children(user)}</>;
}
